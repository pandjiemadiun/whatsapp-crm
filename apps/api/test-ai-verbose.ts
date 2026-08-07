import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

async function main() {
  const response = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [{
        text: 'Jelaskan singkat dalam 50 kata: apa itu Artificial Intelligence?'
      }]
    }],
    generationConfig: {
      maxOutputTokens: 200,
      temperature: 0.7
    }
  });

  console.log('\n=== RAW RESPONSE ===');
  console.log('Stop reason:', response.response.candidates[0].finishReason);
  console.log('Full text:\n', response.response.text());
  console.log('\nUsage:', response.response.usageMetadata);
}

main().catch(console.error);
