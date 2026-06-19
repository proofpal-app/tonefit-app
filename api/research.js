import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-fingerprint');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { song, artist, guitar, amp, partType, toneType, mode } = req.body;
  if (!song || !artist) return res.status(400).json({ error: 'Song and artist are required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // ── CHECK IF USER IS PAID ──
  let isPaid = false;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      isPaid = user?.user_metadata?.paid === true;
    }
  } catch(e) {}

  // ── FREE SEARCH LIMITING (only for non-paid users) ──
  if (!isPaid) {
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const fingerprint = req.headers['x-fingerprint'] || ip;

    try {
      const { data: searchRecord } = await supabase
        .from('search_limits')
        .select('count, reset_at')
        .eq('fingerprint', fingerprint)
        .single();

      const now = new Date();
      const resetDate = searchRecord?.reset_at ? new Date(searchRecord.reset_at) : null;
      const isExpired = !resetDate || now > resetDate;
      const currentCount = isExpired ? 0 : (searchRecord?.count || 0);

      if (currentCount >= 3) {
        return res.status(403).json({
          success: false,
          error: 'FREE_LIMIT_REACHED',
          message: 'You have used your 3 free researches. Upgrade to continue.'
        });
      }

      // Update count
      const nextReset = new Date();
      nextReset.setDate(nextReset.getDate() + 30);

      await supabase.from('search_limits').upsert({
        fingerprint,
        count: isExpired ? 1 : currentCount + 1,
        reset_at: isExpired ? nextReset.toISOString() : searchRecord.reset_at,
        updated_at: now.toISOString()
      }, { onConflict: 'fingerprint' });

    } catch(e) {
      // If DB fails don't block the user — fail open
      console.error('Search limit check failed:', e.message);
    }
  }

  // ── BUILD PROMPT ──
  const isBass = mode === 'bass';
  const prompt = isBass
    ? `You are a bass tone expert. Research the bass tone for "${song}" by ${artist}.
The user gear: Bass: ${guitar || 'Unknown'}, Bass Amp: ${amp || 'Unknown'}, Tone: ${toneType || 'Clean'}.
You MUST respond with ONLY valid JSON. No text, no markdown, no explanation. Just raw JSON exactly like this:
{"originalGear":{"guitar":"bass name","amp":"amp name","pedals":["pedal 1"]},"ampSettings":{"gain":4,"bass":7,"mid":5,"treble":5,"presence":4,"reverb":2},"guitarControls":{"volume":"7-8","tone":"6-7"},"signalChain":"Bass → Amp","pedalsUsed":[{"name":"pedal name","usage":"main tone","note":"description","confidence":80}],"ampEffects":["Compression"],"adaptedSettings":{"summary":"How to achieve this with user bass gear","ampSettings":{"gain":3,"bass":7,"mid":6,"treble":5,"presence":4,"reverb":2},"tips":["tip 1","tip 2"]},"difficulty":{"stars":3,"label":"Moderate","note":"explanation"},"sources":["source 1"],"warnings":["warning 1"]}`
    : `You are a guitar tone expert. Research the guitar tone for "${song}" by ${artist}.
The user gear: Guitar: ${guitar || 'Unknown'}, Amp: ${amp || 'Unknown'}, Part: ${partType || 'Riff'}, Tone: ${toneType || 'Auto-detect'}.
You MUST respond with ONLY valid JSON. No text, no markdown, no explanation. Just raw JSON exactly like this:
{"originalGear":{"guitar":"guitar name","amp":"amp name","pedals":["pedal 1"]},"ampSettings":{"gain":6,"bass":5,"mid":6,"treble":7,"presence":5,"reverb":4},"guitarControls":{"volume":"8-9","tone":"7-8"},"signalChain":"Guitar → Pedal → Amp","pedalsUsed":[{"name":"pedal name","usage":"lead parts","note":"description","confidence":80}],"ampEffects":["Reverb","Delay"],"adaptedSettings":{"summary":"How to achieve this with user gear","ampSettings":{"gain":5,"bass":6,"mid":7,"treble":6,"presence":5,"reverb":4},"tips":["tip 1","tip 2"]},"difficulty":{"stars":3,"label":"Moderate","note":"explanation"},"sources":["source 1","source 2"],"warnings":["warning 1"]}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'API error' });

    const allText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!allText) return res.status(500).json({ error: 'Empty response' });

    const matches = allText.match(/\{[\s\S]*\}/g) || [];
    matches.sort((a, b) => b.length - a.length);

    let toneData = null;
    for (const match of matches) {
      try {
        const parsed = JSON.parse(match);
        if (parsed.ampSettings || parsed.originalGear || parsed.difficulty) {
          toneData = parsed;
          break;
        }
      } catch(e) { continue; }
    }

    if (!toneData) return res.status(500).json({ error: 'Could not parse response', raw: allText.substring(0, 200) });
    return res.status(200).json({ success: true, data: toneData, song, artist });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}