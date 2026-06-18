export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { song, artist, guitar, amp, partType, toneType } = req.body;

  if (!song || !artist) {
    return res.status(400).json({ error: 'Song and artist are required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const prompt = `You are a guitar tone expert. Research the guitar tone for "${song}" by ${artist}.

The user's gear:
- Guitar: ${guitar || 'Unknown'}
- Amp/Multi-FX: ${amp || 'Unknown'}
- Part: ${partType || 'Riff'}
- Tone type: ${toneType || 'Auto-detect'}

Format your response as valid JSON like this:
{
  "originalGear": { "guitar": "guitar name", "amp": "amp name", "pedals": ["pedal 1"] },
  "ampSettings": { "gain": 6, "bass": 5, "mid": 6, "treble": 7, "presence": 5, "reverb": 4 },
  "guitarControls": { "volume": "8-9", "tone": "7-8" },
  "signalChain": "Guitar → Pedal → Amp",
  "pedalsUsed": [{"name": "pedal name", "usage": "when used", "note": "what it does", "confidence": 80}],
  "ampEffects": ["Reverb", "Delay"],
  "adaptedSettings": {
    "summary": "How to achieve this with user gear",
    "ampSettings": { "gain": 5, "bass": 6, "mid": 7, "treble": 6, "presence": 5, "reverb": 4 },
    "tips": ["tip 1", "tip 2"]
  },
  "difficulty": { "stars": 3, "label": "Moderate", "note": "explanation" },
  "sources": ["source 1", "source 2"],
  "warnings": ["warning 1"]
}`;

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
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'API error' });

    const textBlock = data.content?.find(b => b.type === 'text');
    const text = textBlock?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse tone data', raw: text });

    const toneData = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ success: true, data: toneData, song, artist });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}