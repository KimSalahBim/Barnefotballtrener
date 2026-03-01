// Â© 2026 Barnefotballtrener.no. All rights reserved.
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
        // Reason: BokfÃ¸ringsloven requires keeping payment records for 7 years
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

    // 3b) Handle team_members / ownership transfer
    // Teams with other active members get transferred, NOT deleted.
    // Only solo-owned teams (no other members) get deleted.
    let soloTeamIds = [];
    try {
      // Find all teams owned by this user
      const { data: ownedTeams } = await supabaseAdmin
        .from('teams')
        .select('id')
        .eq('user_id', userId);

      const allOwnedIds = (ownedTeams || []).map(t => t.id);

      for (const teamId of allOwnedIds) {
        // Check for other active members (editors)
        const { data: otherMembers } = await supabaseAdmin
          .from('team_members')
          .select('id, user_id, created_at')
          .eq('team_id', teamId)
          .eq('status', 'active')
          .neq('user_id', userId)
          .order('created_at', { ascending: true })
          .limit(1);

        if (otherMembers && otherMembers.length > 0) {
          // Transfer ownership to oldest editor
          const newOwnerId = otherMembers[0].user_id;

          // Update team owner
          await supabaseAdmin
            .from('teams')
            .update({ user_id: newOwnerId })
            .eq('id', teamId);

          // Promote editor to owner role
          await supabaseAdmin
            .from('team_members')
            .update({ role: 'owner' })
            .eq('team_id', teamId)
            .eq('user_id', newOwnerId);

          // Update all data ownership for this team
          // This ensures the new owner's user_id is on all data
          const tables = ['players', 'user_data', 'seasons'];
          for (const table of tables) {
            await supabaseAdmin
              .from(table)
              .update({ user_id: newOwnerId })
              .eq('user_id', userId)
              .eq('team_id', teamId);
          }

          // Update season-linked data (events, season_players, event_players, training_series, match_events)
          const { data: teamSeasons } = await supabaseAdmin
            .from('seasons')
            .select('id')
            .eq('team_id', teamId);

          const seasonIds = (teamSeasons || []).map(s => s.id);
          if (seasonIds.length > 0) {
            for (const table of ['events', 'season_players', 'event_players', 'training_series']) {
              await supabaseAdmin
                .from(table)
                .update({ user_id: newOwnerId })
                .in('season_id', seasonIds)
                .eq('user_id', userId);
            }

            // match_events: need event_ids
            const { data: teamEvents } = await supabaseAdmin
              .from('events')
              .select('id')
              .in('season_id', seasonIds);

            const eventIds = (teamEvents || []).map(e => e.id);
            if (eventIds.length > 0) {
              await supabaseAdmin
                .from('match_events')
                .update({ user_id: newOwnerId })
                .in('event_id', eventIds)
                .eq('user_id', userId);
            }
          }

          deletionResults.steps_completed.push(
            'Transferred team ' + teamId + ' to new owner'
          );
        } else {
          // No other members — mark for deletion
          soloTeamIds.push(teamId);
        }
      }

      // Delete ALL team_members rows for this user (both owned and editor memberships)
      await supabaseAdmin
        .from('team_members')
        .delete()
        .eq('user_id', userId);

      // Also delete pending invitations sent by this user
      await supabaseAdmin
        .from('team_members')
        .delete()
        .eq('invited_by', userId)
        .eq('status', 'pending');

      deletionResults.steps_completed.push(
        'Handled team_members (' + soloTeamIds.length + ' solo teams to delete, ' +
        (allOwnedIds.length - soloTeamIds.length) + ' transferred)'
      );
    } catch (tmErr) {
      console.error('[delete-account] team_members error:', tmErr);
      deletionResults.errors.push('team_members handling error');
      // If this fails, fall back to deleting everything (old behavior)
      const { data: fallbackTeams } = await supabaseAdmin
        .from('teams')
        .select('id')
        .eq('user_id', userId);
      soloTeamIds = (fallbackTeams || []).map(t => t.id);
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

    // 4c) Delete error logs from Supabase
    try {
      const { error: errLogDelErr } = await supabaseAdmin
        .from('error_logs')
        .delete()
        .eq('user_id', userId);

      if (errLogDelErr) {
        console.error('[delete-account] Failed to delete error logs:', errLogDelErr);
        // Ikke-kritisk: ON DELETE SET NULL anonymiserer uansett
      } else {
        deletionResults.steps_completed.push('Deleted error logs from database');
      }
    } catch (errLogDbErr) {
      console.error('[delete-account] Error log database error:', errLogDbErr);
    }

    // 4d) Delete user_data from Supabase
    try {
      const { error: udDelErr } = await supabaseAdmin
        .from('user_data')
        .delete()
        .eq('user_id', userId);

      if (udDelErr) {
        console.error('[delete-account] Failed to delete user_data:', udDelErr);
      } else {
        deletionResults.steps_completed.push('Deleted user_data from database');
      }
    } catch (udDbErr) {
      console.error('[delete-account] user_data database error:', udDbErr);
    }

    // 4e) Delete season module data (children first, then parents)
    // Order: match_events → event_players → events → training_series → season_players → seasons
    // Must run BEFORE teams deletion because seasons.team_id → teams.id
    try {
      // Get event IDs for match_events deletion (match_events lacks season_id)
      const { data: userEvents } = await supabaseAdmin
        .from('events')
        .select('id')
        .eq('user_id', userId);
      const eventIds = (userEvents || []).map(e => e.id);

      // 1. match_events (deepest child, FK → events)
      if (eventIds.length > 0) {
        const { error: meErr } = await supabaseAdmin
          .from('match_events')
          .delete()
          .in('event_id', eventIds)
          .eq('user_id', userId);
        if (meErr) console.error('[delete-account] match_events error:', meErr.message);
      }

      // 2. event_players (FK → events + seasons)
      const { error: epErr } = await supabaseAdmin
        .from('event_players')
        .delete()
        .eq('user_id', userId);
      if (epErr) console.error('[delete-account] event_players error:', epErr.message);

      // 3. events (FK → seasons)
      const { error: evErr } = await supabaseAdmin
        .from('events')
        .delete()
        .eq('user_id', userId);
      if (evErr) console.error('[delete-account] events error:', evErr.message);

      // 4. training_series (FK → seasons)
      const { error: tsErr } = await supabaseAdmin
        .from('training_series')
        .delete()
        .eq('user_id', userId);
      if (tsErr) console.error('[delete-account] training_series error:', tsErr.message);

      // 5. season_players (FK → seasons)
      const { error: spErr } = await supabaseAdmin
        .from('season_players')
        .delete()
        .eq('user_id', userId);
      if (spErr) console.error('[delete-account] season_players error:', spErr.message);

      // 6. seasons (parent, has FK → teams)
      const { error: snErr } = await supabaseAdmin
        .from('seasons')
        .delete()
        .eq('user_id', userId);
      if (snErr) console.error('[delete-account] seasons error:', snErr.message);

      deletionResults.steps_completed.push('Deleted season data (seasons, events, attendance, goals, roster, training series)');
    } catch (seasonDbErr) {
      console.error('[delete-account] Season module database error:', seasonDbErr);
      deletionResults.errors.push('Database error during season data deletion');
    }

    // 4f) Delete teams from Supabase (CASCADE sletter spillere automatisk, men vi har allerede slettet dem)
    try {
      const { error: teamDelErr } = await supabaseAdmin
        .from('teams')
        .delete()
        .eq('user_id', userId);

      if (teamDelErr) {
        console.error('[delete-account] Failed to delete teams:', teamDelErr);
      } else {
        deletionResults.steps_completed.push('Deleted teams from database');
      }
    } catch (teamDbErr) {
      console.error('[delete-account] Team database error:', teamDbErr);
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
    console.log('[delete-account] âœ… Account deleted:', {
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
      note: 'Payment records are retained for 7 years per Norwegian accounting law (bokfÃ¸ringsloven), but your personal information has been anonymized.',
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
