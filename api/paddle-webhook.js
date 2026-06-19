import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['paddle-signature'];
  const rawBody = JSON.stringify(req.body);

  // Verify webhook is from Paddle
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(rawBody);
  const expectedSig = hmac.digest('hex');

  if (signature !== expectedSig) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const eventType = event.event_type;

  if (
    eventType === 'subscription.activated' ||
    eventType === 'subscription.updated' ||
    eventType === 'transaction.completed'
  ) {
    const email = event.data?.customer?.email ||
                  event.data?.billing_details?.email;
    const planId = event.data?.items?.[0]?.price?.id;

    let plan = 'beginner';
    if (
      planId === 'pri_01kvcj3vt1snrym410dz16jh06' ||
      planId === 'pri_01kvcj65rtdv19p68kbn1jsvvh'
    ) {
      plan = 'expert';
    }

    if (email) {
      // Update user in Supabase
      const { data: users } = await supabase.auth.admin.listUsers();
      const user = users?.users?.find(u => u.email === email);

      if (user) {
        await supabase.auth.admin.updateUserById(user.id, {
          user_metadata: {
            plan: plan,
            paid: true,
            paddle_subscription_id: event.data?.id
          }
        });
      }
    }
  }

  if (
    eventType === 'subscription.canceled' ||
    eventType === 'subscription.paused'
  ) {
    const email = event.data?.customer?.email;
    if (email) {
      const { data: users } = await supabase.auth.admin.listUsers();
      const user = users?.users?.find(u => u.email === email);
      if (user) {
        await supabase.auth.admin.updateUserById(user.id, {
          user_metadata: { plan: 'free', paid: false }
        });
      }
    }
  }

  res.status(200).json({ received: true });
}