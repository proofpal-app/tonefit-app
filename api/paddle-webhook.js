const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const event = req.body;
    const eventType = event.event_type;

    console.log('Paddle webhook received:', eventType);

    if (
      eventType === 'subscription.activated' ||
      eventType === 'subscription.updated' ||
      eventType === 'transaction.completed' ||
      eventType === 'transaction.paid'
    ) {
      const email = 
        event.data?.customer?.email ||
        event.data?.billing_details?.email ||
        event.data?.items?.[0]?.price?.billing_details?.email;

      const planId = event.data?.items?.[0]?.price?.id;

      let plan = 'beginner';
      if (
        planId === 'pri_01kvcj3vt1snrym410dz16jh06' ||
        planId === 'pri_01kvcj65rtdv19p68kbn1jsvvh'
      ) {
        plan = 'expert';
      }

      console.log('Processing payment for:', email, 'plan:', plan);

      if (email) {
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const user = users?.find(u => u.email === email);

        if (user) {
          await supabase.auth.admin.updateUserById(user.id, {
            user_metadata: {
              plan: plan,
              paid: true,
              paddle_subscription_id: event.data?.id
            }
          });
          console.log('User updated:', email, plan);
        } else {
          console.log('User not found for email:', email);
        }
      }
    }

    if (
      eventType === 'subscription.canceled' ||
      eventType === 'subscription.paused'
    ) {
      const email = event.data?.customer?.email;
      
      if (email) {
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const user = users?.find(u => u.email === email);
        
        if (user) {
          await supabase.auth.admin.updateUserById(user.id, {
            user_metadata: { plan: 'free', paid: false }
          });
          console.log('User downgraded:', email);
        }
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ received: true });
  }
}