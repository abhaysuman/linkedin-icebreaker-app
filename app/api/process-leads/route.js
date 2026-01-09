import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// Helper: Clean name by removing digits and extra spaces
function formatName(rawName, url) {
  try {
    // 1. If we have a name, remove numbers (e.g. "Anil Kumar 123" -> "Anil Kumar")
    if (rawName && rawName !== "undefined undefined") {
      const clean = rawName.replace(/[0-9]/g, '').trim();
      if (clean.length > 2) return clean;
    }

    // 2. Fallback: Extract from URL (e.g. linkedin.com/in/anil-kumar-b123 -> "Anil Kumar")
    if (url) {
      const slug = url.split('/in/')[1]?.split('/')[0] || "";
      // Remove trailing ID parts often found in URLs (e.g. -3b48a91)
      const namePart = slug.split('-').filter(part => !part.match(/^[a-zA-Z0-9]{5,}$/)).join(' '); 
      
      // Capitalize
      return namePart
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase()) || "there";
    }
    return "there";
  } catch (e) {
    return "there";
  }
}

export async function POST(req) {
  try {
    const { apifyKey, apiKey, provider, profileUrl, customPrompt } = await req.json();

    console.log(`\n--- PROCESSING: ${profileUrl} ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });

    // Using the paid 'dev_fusion' scraper
    const run = await apifyClient.actor("dev_fusion/linkedin-profile-scraper").call({
      profileUrls: [profileUrl],
    });

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    const profileData = items[0];

    if (!profileData) {
      console.error("❌ Apify returned no data!");
      throw new Error("Failed to scrape data. Please check the URL.");
    }

    // --- 1. CLEAN NAME EXTRACTION ---
    const rawName = profileData.fullName || `${profileData.firstName || ''} ${profileData.lastName || ''}`;
    const fullName = formatName(rawName, profileUrl);
    const firstName = fullName.split(' ')[0];

    // --- 2. MAP RICH DATA ---
    const headline = profileData.headline || "";
    const about = profileData.summary || profileData.about || "";
    const company = profileData.currentJob?.company || "your company";
    
    // Extract Posts (Key for your requested icebreaker style)
    const postsRaw = profileData.posts || profileData.activities || [];
    
    // Prepare Data Context
    const summaryData = `
      Name: ${fullName}
      Current Company: ${company}
      Headline: ${headline}
      About: ${about} 
      
      RECENT POSTS/ACTIVITY (Use this for the hook): 
      ${JSON.stringify(postsRaw.slice(0, 3))}
      
      CAREER HISTORY: 
      ${JSON.stringify(profileData.experience?.slice(0, 3) || [])}
    `;

    console.log("✅ Data Mapped for:", fullName);

    // --- 3. SYSTEM PROMPT: "BIGSTEP" FRAMEWORK ---
    const systemPrompt = `
      You are an expert SDR at BigStep Technologies.
      
      YOUR GOAL: 
      Write a specific, problem-solving cold DM based on the lead's activity.
      
      LEAD DATA:
      ${summaryData}

      USER CONTEXT / EXTRA INSTRUCTIONS:
      ${customPrompt || ""}

      STRUCTURE (Follow this EXACTLY):
      1. **Greeting:** "Hi ${firstName},"
      2. **The Hook (Icebreaker):** Reference a SPECIFIC post, comment, or news event from their data.
         - *Example:* "Just saw your post about brands creating experiences, not just ads."
         - *Fallback (only if no posts):* Reference a specific achievement in their career/headline.
      3. **The Problem (Bridge):** Validate why that is hard/valuable.
         - *Example:* "Making those ideas happen, and building products that truly connect, can be tough."
      4. **The Solution (BigStep Pitch):** Mention how BigStep helps.
         - *Context:* BigStep Technologies helps with Software Product Dev, E-Commerce, Data Analytics, and AI.
         - *Example:* "At BigStep Technologies, we help companies with Software Product Dev to bring those powerful brand experiences to life."
      5. **The CTA:**
         - *Example:* "Curious how that could help ${company}?"

      STRICT RULES:
      - **NO Numbers in Names:** Ensure the name is clean (e.g. "Anil", not "Anil904").
      - **NO Generic Fluff:** Do not say "Impressive profile." Quote their actual content.
      - **Tone:** Professional, insightful, helpful.

      OUTPUT FORMAT (JSON ONLY):
      {
        "icebreaker": "The 1-sentence hook about their post/news",
        "message": "The full message following the structure above."
      }
    `;

    let resultText = "";

    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey: apiKey });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful assistant that outputs JSON." },
          { role: "user", content: systemPrompt },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      });
      resultText = completion.choices[0].message.content;

    } else if (provider === 'gemini') {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
      });
      
      const result = await model.generateContent(systemPrompt);
      const response = await result.response;
      resultText = response.text();
    }

    const parsedResult = JSON.parse(cleanJson(resultText));

    return NextResponse.json({
      name: fullName,
      profileUrl: profileUrl,
      icebreaker: parsedResult.icebreaker,
      message: parsedResult.message
    });

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "Something went wrong" }, { status: 500 });
  }
}