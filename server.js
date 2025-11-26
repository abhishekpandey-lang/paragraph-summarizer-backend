import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

// Global handlers to prevent the process from exiting on unexpected errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced CORS configuration for browser requests
app.use(cors({
  origin: ['http://localhost:3000', 'chrome-extension://*', '*'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

let openai = null;
// Prefer an OpenAI API key, but keep backward compatibility with XAI_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.XAI_API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || 'gpt-oss-20b';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';

console.log('=== ENVIRONMENT VARIABLES ===');
console.log('OPENAI_API_KEY:', OPENAI_API_KEY ? `${OPENAI_API_KEY.substring(0, 20)}...` : 'NOT SET');
console.log('MODEL_NAME:', MODEL_NAME);
console.log('OPENAI_BASE_URL:', OPENAI_BASE_URL);
console.log('=============================');
if (!OPENAI_API_KEY) {
  console.error('❌ ERROR: OPENAI_API_KEY (or XAI_API_KEY) is not set!');
} else {
  // Use OPENAI_BASE_URL or default to OpenRouter
  const baseURL = OPENAI_BASE_URL;
  openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
    baseURL: baseURL,
    timeout: 90000, // 90 second timeout for Vercel serverless
    maxRetries: 3,
    defaultHeaders: {
      'HTTP-Referer': 'https://paragraph-summarizer-backend.vercel.app',
      'X-Title': 'Paragraph Summarizer Chrome Extension'
    },
    dangerouslyAllowBrowser: false
  });
  console.log('✅ OpenAI client initialized with baseURL:', baseURL);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'running',
    model: MODEL_NAME,
    apiKeyConfigured: !!OPENAI_API_KEY,
    baseURL: OPENAI_BASE_URL,
    message: OPENAI_API_KEY ? 'API key is configured' : 'WARNING: API key not configured'
  });
});

app.post('/api/summarize', async (req, res) => {
  try {
    const { paragraphs } = req.body;

    if (!paragraphs || !Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ 
        error: 'Please provide paragraphs' 
      });
    }

    console.log(`Received ${paragraphs.length} paragraphs for summarization`);

    const combinedText = paragraphs.join('\n\n');
    
    const prompt = `Please summarize the following text comprehensively and present ALL important key points as bullet points. The summary should capture the main ideas and be clear and easy to understand:

${combinedText}

Please format the answer as:
• First key point
• Second key point
• Third key point
• ... (include all important points, not limited to 3)`;

    if (!openai) {
      return res.status(500).json({
        error: 'API key not configured. Set OPENAI_API_KEY (or XAI_API_KEY) in your environment or .env file.'
      });
    }

    // Direct fetch instead of OpenAI SDK for better Vercel compatibility
    const fetchResponse = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'HTTP-Referer': 'https://paragraph-summarizer-backend.vercel.app',
        'X-Title': 'Paragraph Summarizer Chrome Extension'
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          {
            role: "system",
            content: "You are an expert summarizer who converts complex information into simple short, understandable points."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 2500,
        temperature: 0.7
      })
    });

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      console.error('OpenRouter API error:', fetchResponse.status, errorText);
      return res.status(500).json({
        error: 'API request failed',
        details: `${fetchResponse.status}: ${errorText}`
      });
    }

    const responseData = await fetchResponse.json();
    const summary = responseData.choices[0].message.content;
    
    console.log('Summary generated successfully');
    
    res.json({
      success: true,
      summary: summary,
      paragraphCount: paragraphs.length,
      model: MODEL_NAME
    });

  } catch (error) {
    console.error('Error generating summary:', error && error.message ? error.message : error);
    res.status(500).json({
      error: 'Error generating summary',
      details: error && error.message ? error.message : String(error)
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Paragraph Summarizer API is running',
    model: MODEL_NAME
  });
});

// Translate endpoint: accepts { text, target } and returns translated text
app.post('/api/translate', async (req, res) => {
  try {
    const { text, target } = req.body;
    console.log('[TRANSLATE] Received request. Text length:', text ? text.length : 0);

    if (!text || typeof text !== 'string') {
      console.error('[TRANSLATE] Invalid text provided');
      return res.status(400).json({ error: 'Please provide text to translate' });
    }

    // No truncation - translate full text
    const textToTranslate = text;

    const lang = (target && typeof target === 'string') ? target : 'hi'; // default to Hindi
    console.log('[TRANSLATE] Target language:', lang);

    if (!openai) {
      console.error('[TRANSLATE] OpenAI client not initialized. API key missing.');
      return res.status(500).json({
        error: 'API key not configured. Set OPENAI_API_KEY (or XAI_API_KEY) in your environment or .env file.'
      });
    }

    // Auto-detect language and translate accordingly
    let targetLang = lang;
    
    // Always auto-detect source language and translate to opposite
    const isHindi = /[\u0900-\u097F]/.test(textToTranslate); // Unicode range for Devanagari
    targetLang = isHindi ? 'English' : 'Hindi';
    console.log('[TRANSLATE] Auto-detected: text is', isHindi ? 'Hindi' : 'English', '→ Translating to:', targetLang);
    const translatePrompt = `Translate the following text into ${targetLang}. Preserve the original formatting (bullet points, lists, and newlines) as much as possible.\n\n${textToTranslate}`;

    console.log('[TRANSLATE] Calling model:', MODEL_NAME, 'Prompt length:', translatePrompt.length);
    
    // Direct fetch instead of OpenAI SDK for better Vercel compatibility
    let fetchResponse;
    try {
      fetchResponse = await Promise.race([
        fetch(`${OPENAI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'HTTP-Referer': 'https://paragraph-summarizer-backend.vercel.app',
            'X-Title': 'Paragraph Summarizer Chrome Extension'
          },
          body: JSON.stringify({
            model: MODEL_NAME,
            messages: [
              { role: 'system', content: 'You are a helpful translator. Translate accurately while preserving formatting.' },
              { role: 'user', content: translatePrompt }
            ],
            max_tokens: 4000,
            temperature: 0.3
          })
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Translation timeout after 60 seconds')), 60000)
        )
      ]);
      
      if (!fetchResponse.ok) {
        const errorText = await fetchResponse.text();
        console.error('[TRANSLATE] OpenRouter API error:', fetchResponse.status, errorText);
        
        if (fetchResponse.status === 429) {
          return res.status(429).json({ 
            error: 'Rate limited by translation service', 
            details: 'Please try again in a moment'
          });
        }
        
        return res.status(500).json({ 
          error: 'Model API error', 
          details: `${fetchResponse.status}: ${errorText}`,
          model: MODEL_NAME
        });
      }
      
      const response = await fetchResponse.json();
      console.log('[TRANSLATE] Response received. Choices:', response.choices ? response.choices.length : 0);
      
      if (!response || !response.choices || response.choices.length === 0) {
        console.error('[TRANSLATE] No choices in response:', response);
        return res.status(500).json({ error: 'Translation failed: no choices in response' });
      }

      let translated = response.choices[0] && response.choices[0].message && response.choices[0].message.content
        ? response.choices[0].message.content
        : null;

      // Fallback: if content is empty but reasoning exists (from Deepseek-style models), extract from reasoning
      if (!translated && response.choices[0] && response.choices[0].message && response.choices[0].message.reasoning) {
        console.warn('[TRANSLATE] Content empty but reasoning exists. Extracting translation from reasoning...');
        const reasoning = response.choices[0].message.reasoning;
        // Try to extract English translations from reasoning (last few complete translations)
        const matches = reasoning.match(/English: "([^"]+)"/g);
        if (matches && matches.length > 0) {
          // Extract last few translations and reconstruct
          translated = matches
            .map(m => m.replace(/English: "/, '').replace(/"$/, ''))
            .map(t => '• ' + t)
            .join('\n');
          console.log('[TRANSLATE] Extracted from reasoning. Length:', translated.length);
        }
      }

      if (!translated) {
        console.error('[TRANSLATE] Model returned empty content. Choices[0]:', response.choices[0]);
        
        // Fallback: return original text with truncation marker
        console.warn('[TRANSLATE] Falling back to original text due to model issues');
        return res.json({ 
          success: true, 
          translatedText: textToTranslate,
          warning: 'Translation service had issues. Showing original text.'
        });
      }

      console.log('[TRANSLATE] Translation successful. Length:', translated.length);
      res.json({ success: true, translatedText: translated });
    } catch (apiErr) {
      console.error('[TRANSLATE] API call error:', apiErr && apiErr.message ? apiErr.message : String(apiErr));
      return res.status(500).json({ 
        error: 'Translation API error', 
        details: apiErr && apiErr.message ? apiErr.message : String(apiErr),
        model: MODEL_NAME
      });
    }
  } catch (error) {
    console.error('[TRANSLATE] Unexpected error:', error && error.message ? error.message : error);
    res.status(500).json({ error: 'Error translating text', details: error && error.message ? error.message : String(error) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server started on http://0.0.0.0:${PORT}`);
  console.log(`Model: ${MODEL_NAME}`);
});
