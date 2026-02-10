// © 2026 Barnefotballtrener.no. All rights reserved.
// api/delete-account.js
// GDPR Art. 17 - Right to Erasure ("Right to be Forgotten")
// Allows users to permanently delete their account and all associated data
//
// Required env vars:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - STRIPE_SECRET_KEY

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  timeout: 10000,
  maxNetworkRetries: 2,
});

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}


function isDebugHost(hostHeader) {
  const h = String(hostHeader || '').toLowerCase().split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app');
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // 1) Authenticate user
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    
    if (!token) {
      return res.status(401).json({ error: 'Missing Bearer token' });
    }

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    
    if (userErr || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const userId = user.id;
    const email = user.email;

    if (!email) {
      return res.status(400).json({ error: 'User has no email' });
    }

    // 2) Parse request body for confirmation
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch (_) {}

    const confirmation = body.confirmation;
    if (confirmation !== 'DELETE_MY_ACCOUNT') {
      return res.status(400).json({ 
        error: 'Missing confirmation',
        required: 'You must send { "confirmation": "DELETE_MY_ACCOUNT" } in request body',
      });
    }

    const deletionResults = {
      timestamp: new Date().toISOString(),
      user_id: userId,
      email: email,
      steps_completed: [],
      errors: [],
    };

    // 3) Cancel active Stripe subscriptions (IMPORTANT: Do this BEFORE deleting customer)
    try {
      const normalizedEmail = normalizeEmail(email);
      const customerList = await stripe.customers.list({ 
        email: normalizedEmail, 
        limit: 10 
      });

      const customers = (customerList.data || []).filter(c => {
        const metaId = c?.metadata?.supabase_user_id;
        if (metaId === userId) return true;
        if (!metaId) {
          console.warn(`[delete-account] Including legacy Stripe customer ${c.id} (no supabase_user_id metadata) for email ${normalizedEmail}`);
          return true;
        }
        return false;
      });

      if (customers.length > 0) {
        const customer = customers[0];
        const customerId = customer.id;

        // Cancel all subscriptions (including trialing, past_due, unpaid)
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 100,
        });

        for (const sub of subscriptions.data || []) {
          if (!sub || sub.status === 'canceled') continue;
          try {
            await stripe.subscriptions.cancel(sub.id);
            deletionResults.steps_completed.push('Cancelled subscription (' + sub.status + ')');
          } catch (cancelErr) {
            console.error('[delete-account] Failed to cancel subscription:', cancelErr);
            deletionResults.errors.push('Could not cancel a subscription');
          }
        }

        // NOTE: We do NOT delete the Stripe customer record
        // Reason: Bokføringsloven requires keeping payment records for 7 years
        // Instead, we anonymize the customer metadata
        try {
          await stripe.customers.update(customerId, {
            metadata: {
              supabase_user_id: `DELETED_${Date.now()}`,
              deletion_timestamp: new Date().toISOString(),
              gdpr_article_17: 'true',
            },
            description: 'Account deleted per GDPR Art. 17',
          });
          deletionResults.steps_completed.push('Anonymized Stripe customer metadata');
        } catch (updateErr) {
          console.error('[delete-account] Failed to anonymize customer:', updateErr);
          deletionResults.errors.push('Could not anonymize Stripe customer');
        }
      } else {
        deletionResults.steps_completed.push('No Stripe customer found (nothing to cancel)');
      }
    } catch (stripeErr) {
      console.error('[delete-account] Stripe error:', stripeErr);
      deletionResults.errors.push('Stripe processing error');
    }

    // 4) Delete trial data from Supabase
    try {
      const { error: deleteErr } = await supabaseAdmin
        .from('user_access')
        .delete()
        .eq('user_id', userId);

      if (deleteErr) {
        console.error('[delete-account] Failed to delete trial data:', deleteErr);
        deletionResults.errors.push('Could not delete trial data');
      } else {
        deletionResults.steps_completed.push('Deleted trial data from database');
      }
    } catch (dbErr) {
      console.error('[delete-account] Database error:', dbErr);
      deletionResults.errors.push('Database error during deletion');
    }

    // 4b) Delete player data from Supabase
    try {
      const { error: playerDelErr } = await supabaseAdmin
        .from('players')
        .delete()
        .eq('user_id', userId);

      if (playerDelErr) {
        console.error('[delete-account] Failed to delete player data:', playerDelErr);
        deletionResults.errors.push('Could not delete player data');
      } else {
        deletionResults.steps_completed.push('Deleted player data from database');
      }
    } catch (playerDbErr) {
      console.error('[delete-account] Player database error:', playerDbErr);
      deletionResults.errors.push('Database error during player deletion');
    }

    // 5) Delete Supabase Auth user (THIS MUST BE LAST - deletes the session token!)
    try {
      const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      
      if (authDeleteErr) {
        console.error('[delete-account] Failed to delete auth user:', authDeleteErr);
        deletionResults.errors.push('Could not delete auth user');
        
        // CRITICAL: If we can't delete the auth user, the deletion is incomplete
        return res.status(500).json({
          error: 'Account deletion incomplete',
          details: deletionResults,
          message: 'Some data was deleted, but your account still exists. Please contact support.',
        });
      } else {
        deletionResults.steps_completed.push('Deleted Supabase Auth user account');
      }
    } catch (authErr) {
      console.error('[delete-account] Auth error:', authErr);
      deletionResults.errors.push('Auth deletion error');
      
      return res.status(500).json({
        error: 'Account deletion incomplete',
        details: deletionResults,
        message: 'Some data was deleted, but your account still exists. Please contact support.',
      });
    }

    // 6) Log deletion for audit trail (GDPR compliance requirement)
    console.log('[delete-account] ✅ Account deleted:', {
      user_id: userId,
      email: email,
      timestamp: new Date().toISOString(),
      steps_completed: deletionResults.steps_completed.length,
      errors: deletionResults.errors.length,
    });

    // 7) Success response
    return res.status(200).json({
      success: true,
      message: 'Your account has been permanently deleted.',
      details: deletionResults,
      note: 'Payment records are retained for 7 years per Norwegian accounting law (bokføringsloven), but your personal information has been anonymized.',
    });

  } catch (err) {
    const errorId = `da_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    console.error('[delete-account] error_id=%s', errorId, err);

    const debug = isDebugHost(req.headers.host);
    return res.status(500).json({
      error: 'Server error',
      message: 'Account deletion failed. Please contact support at support@barnefotballtrener.no',
      ...(debug ? { error_id: errorId } : {}),
    });
  }
}
