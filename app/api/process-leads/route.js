import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// Helper: Extract name from URL if scraper fails (e.g. linkedin.com/in/john-doe -> John Doe)
function getNameFromUrl(url) {
  try {
    if (!url) return "there";
    const slug = url.split('/in/')[1]?.split('/')[0] || "";
    // Replace dashes with spaces and Capitalize Words
    return slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase()) || "there";
  } catch (e) {
    return "there";
  }
}

export async function POST(req) {
  try {
    const { apifyKey, apiKey, provider, profileUrl, customPrompt } = await req.json();

    console.log(`\n--- PROCESSING: ${profileUrl} ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });

    console.log("Starting Scraper: dev_fusion/linkedin-profile-scraper...");
    
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

    // --- BULLETPROOF DATA MAPPING ---
    
    // 1. Try to find the Name (Priority Order)
    let fullName = profileData.fullName || profileData.name;
    
    if (!fullName && profileData.firstName && profileData.lastName) {
      fullName = `${profileData.firstName} ${profileData.lastName}`;
    }
    
    // Fallback: If scraper returned NULL for name, grab it from the URL
    if (!fullName || fullName === "undefined undefined") {
      console.log("⚠️ Name missing in data. Extracting from URL...");
      fullName = getNameFromUrl(profileUrl);
    }

    const firstName = fullName.split(' ')[0] || "there";
    const headline = profileData.headline || profileData.occupation || "";
    const about = profileData.summary || profileData.about || "";
    
    // Handle specific array formats
    const postsRaw = profileData.posts || profileData.activities || [];
    const experienceRaw = profileData.experience || profileData.positions || [];
    const educationRaw = profileData.education || [];

    // --------------------------------

    // Prepare Context
    const summaryData = `
      Name: ${fullName}
      Headline: ${headline}
      About: ${about} 
      LATEST ACTIVITY: ${JSON.stringify(postsRaw.slice(0, 5))}
      CAREER HISTORY: ${JSON.stringify(experienceRaw.slice(0, 3))}
      EDUCATION: ${JSON.stringify(educationRaw)}
    `;

    console.log("✅ Data Mapped Successfully for:", fullName);

    // SYSTEM PROMPT: DYNAMIC HUMAN CONVERSATION
    const systemPrompt = `
      You are an expert networker. Your goal is to write a genuine, short connection request message.

      THE LEAD'S DATA:
      ${summaryData}

      YOUR GOAL:
      Write a message that feels 100% human. It must be short (under 50 words) and flow naturally.

      STEP 1: THE ICEBREAKER (The "Why")
      - Find the strongest signal (Product Launch, Promotion, Post, or Shared Background).
      - Validate it naturally. (e.g., "Just saw the news about X—huge move.")
      - If NO signal is found, reference their Headline/Role (e.g. "Impressive track record at [Company].")

      STEP 2: THE BRIDGE (The "Connection")
      - Do NOT use a hardcoded phrase. Adapt the transition to the context:
        - *If they are a founder:* "Love watching how you're scaling this."
        - *If they shared an insight:* "It's a perspective we don't see enough of in the industry."
        - *If they are a peer:* "Always great to connect with others deep in the [Industry] weeds."
        - *If they got promoted:* "Excited to see what you do with the new scope."

      STEP 3: THE CLOSE (The "Casual Ask")
      - Keep it low pressure.
      - Examples: "Would love to connect.", "Hope to cross paths.", "Great to have you in my network."

      STRICT RULES:
      - Start with "Hi ${firstName},"
      - NO "I hope this email finds you well."
      - NO "undefined" words.
      - Make every message sound slightly different based on the specific signal found.

      USER CUSTOM CONDITIONS:
      ${customPrompt || ""}

      OUTPUT FORMAT (JSON ONLY):
      {
        "signal_used": "e.g. Funding Round",
        "icebreaker": "The specific observation",
        "message": "The full message: Hi [Name], [Icebreaker]. [Bridge]. [Casual Close]."
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
        temperature: 0.8,
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