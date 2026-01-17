import { GoogleGenAI } from "@google/genai";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API_KEY is missing from environment variables.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const generateSocialPost = async (description: string, platform: 'Instagram' | 'TikTok' | 'YouTube') => {
  const client = getClient();
  if (!client) {
    throw new Error("API Key not found. Please ensure you are using a paid API key for Veo/Gemini models.");
  }

  const prompt = `
    You are a social media expert.
    Write a viral, engaging caption for a ${platform} video.
    
    Video Context: ${description}
    
    Requirements:
    - Catchy hook in the first line.
    - Use relevant emojis.
    - Include 5-10 targeted hashtags at the bottom.
    - Keep the tone exciting and professional.
  `;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error("Failed to generate captions. Please check your API key.");
  }
};
