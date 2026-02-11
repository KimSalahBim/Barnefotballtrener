// © 2026 Barnefotballtrener.no. All rights reserved.
// api/export-data.js
// GDPR Art. 20 - Right to Data Portability
// Allows users to export all their personal data in machine-readable format (JSON)
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
  // SECURITY: Prevent caching of personalized data
  res.setHeader('Cache-Control', 'no-store, private, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
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

    // 2) Gather all user data from multiple sources
    const exportData = {
      export_info: {
        exported_at: new Date().toISOString(),
        export_version: '1.0',
        format: 'JSON',
        gdpr_article: 'Art. 20 - Right to Data Portability',
      },
      
      account_info: {
        user_id: userId,
        email: email,
        created_at: user.created_at || null,
        last_sign_in: user.last_sign_in_at || null,
        auth_provider: user.app_metadata?.provider || 'unknown',
      },
      
      app_data: {
        teams: [], // Fylles fra Supabase under
        players: [], // Fylles fra Supabase under
        note: 'Settings and training data are stored locally in your browser. Use the "Export" button in the app to download this data.',
      },
    };

    // 2b) Fetch teams from Supabase
    try {
      const { data: teamData, error: teamError } = await supabaseAdmin
        .from('teams')
        .select('id, name, color, created_at')
        .eq('user_id', userId);

      if (!teamError && teamData) {
        exportData.app_data.teams = teamData;
      }
    } catch (teamErr) {
      console.error('[export-data] Teams fetch error:', teamErr);
    }

    // 2c) Fetch player data from Supabase
    try {
      const { data: playerData, error: playerError } = await supabaseAdmin
        .from('players')
        .select('id, name, skill, goalie, active, team_id, updated_at')
        .eq('user_id', userId);

      if (!playerError && playerData) {
        exportData.app_data.players = playerData;
      }
    } catch (playerErr) {
      console.error('[export-data] Players fetch error:', playerErr);
      exportData.app_data.players_error = 'Could not fetch player data';
    }

    // 2d) Fetch user_data (settings, workouts, competitions, etc.)
    try {
      const { data: userData, error: udError } = await supabaseAdmin
        .from('user_data')
        .select('team_id, key, value, updated_at')
        .eq('user_id', userId);

      if (!udError && userData) {
        exportData.app_data.user_data = userData;
      }
    } catch (udErr) {
      console.error('[export-data] user_data fetch error:', udErr);
    }

    // 2c) Fetch error logs from Supabase
    try {
      const { data: errorData, error: errorErr } = await supabaseAdmin
        .from('error_logs')
        .select('id, message, source, lineno, colno, user_agent, url, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (!errorErr && errorData) {
        exportData.app_data.error_logs = errorData;
      }
    } catch (errLogErr) {
      console.error('[export-data] Error logs fetch error:', errLogErr);
    }

    // 3) Fetch Stripe subscription data (if customer exists)
    try {
      const normalizedEmail = normalizeEmail(email);
      const customerList = await stripe.customers.list({ 
        email: normalizedEmail, 
        limit: 10 
      });

      const customers = (customerList.data || []).filter(c => {
        const metaId = c?.metadata?.supabase_user_id;
        return !metaId || metaId === userId;
      });

      if (customers.length > 0) {
        const customer = customers[0];
        const customerId = customer.id;

        // Get subscriptions
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 100,
        });

        // Get invoices
        const invoices = await stripe.invoices.list({
          customer: customerId,
          limit: 100,
        });

        // Get checkout sessions
        const sessions = await stripe.checkout.sessions.list({
          customer: customerId,
          limit: 100,
        });

        exportData.subscription_data = {
          customer_id: customerId,
          customer_created: customer.created ? new Date(customer.created * 1000).toISOString() : null,
          subscriptions: (subscriptions.data || []).map(sub => ({
            id: sub.id,
            status: sub.status,
            plan: sub.metadata?.plan_type || 'unknown',
            created: sub.created ? new Date(sub.created * 1000).toISOString() : null,
            current_period_start: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null,
            current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
            cancel_at_period_end: sub.cancel_at_period_end || false,
            canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
          })),
          invoices: (invoices.data || []).map(inv => ({
            id: inv.id,
            status: inv.status,
            amount_paid: inv.amount_paid / 100, // Convert from cents
            currency: inv.currency,
            created: inv.created ? new Date(inv.created * 1000).toISOString() : null,
            invoice_pdf: inv.invoice_pdf || null,
          })),
          purchase_history: (sessions.data || [])
            .filter(s => s.payment_status === 'paid')
            .map(s => ({
              session_id: s.id,
              amount_total: s.amount_total / 100,
              currency: s.currency,
              created: s.created ? new Date(s.created * 1000).toISOString() : null,
              mode: s.mode,
              plan_type: s.metadata?.plan_type || 'unknown',
            })),
        };
      } else {
        exportData.subscription_data = {
          note: 'No Stripe customer record found. You may not have made any purchases yet.',
        };
      }
    } catch (stripeErr) {
      console.error('[export-data] Stripe fetch error:', stripeErr);
      exportData.subscription_data = {
        error: 'Could not fetch subscription data',
        message: 'Please contact support if you need this information.',
      };
    }

    // 4) Fetch trial data from Supabase (if exists)
    try {
      const { data: trialData, error: trialErr } = await supabaseAdmin
        .from('user_access')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!trialErr && trialData) {
        exportData.trial_data = trialData;
      }
    } catch (dbErr) {
      console.error('[export-data] Database fetch error:', dbErr);
    }

    // 5) Return as downloadable JSON
    const filename = `barnefotballtrener-data-${userId.substring(0, 8)}-${Date.now()}.json`;
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    return res.status(200).json(exportData);

  } catch (err) {
    const errorId = `ed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    console.error('[export-data] error_id=%s', errorId, err);

    const debug = isDebugHost(req.headers.host);
    return res.status(500).json({
      error: 'Server error',
      message: 'Could not export data. Please try again or contact support.',
      ...(debug ? { error_id: errorId } : {}),
    });
  }
}
