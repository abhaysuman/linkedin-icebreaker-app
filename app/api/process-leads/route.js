import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// Helper: Clean Name from URL
function getNameFromUrl(url) {
  try {
    if (!url) return "there";
    const slug = url.split('/in/')[1]?.split('/')[0] || "";
    const cleanedSlug = slug.replace(/-[\d\w]+$/, '').replace(/-/g, ' '); 
    return cleanedSlug.replace(/\b\w/g, l => l.toUpperCase()) || "there";
  } catch (e) {
    return "there";
  }
}

export async function POST(req) {
  try {
    const { apifyKey, apiKey, provider, profileUrl, customPrompt, myOffer } = await req.json();

    // CHECK: DO WE HAVE AN OFFER?
    const hasOffer = myOffer && myOffer.trim().length > 5;

    console.log(`\n--- PROCESSING: ${profileUrl} (Mode: ${hasOffer ? 'Sales Bridge' : 'Natural Networking'}) ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });
    
    // SWITCH: Using 'freshdata/fresh-linkedin-profile-data' (Reliable No-Cookie Alternative)
    // MAKE SURE you added this actor: https://apify.com/freshdata/fresh-linkedin-profile-data
    console.log("Starting Scraper: freshdata/fresh-linkedin-profile-data...");
    
    // Note: This actor expects input as 'linkedin_url' or 'url' depending on version, 
    // but standard Apify actors often accept 'startUrls' or similar. 
    // For FreshData, the documented input is often simple.
    const run = await apifyClient.actor("freshdata/fresh-linkedin-profile-data").call({
      linkedin_url: profileUrl, // Specific input key for this actor
      url: profileUrl // Backup key just in case
    });

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    
    // FreshData often wraps the result in a 'data' object or returns it directly
    const rawItem = items[0];
    const profileData = rawItem?.data || rawItem;

    if (!profileData) {
        throw new Error("Scraper finished but returned no data. Profile might be private.");
    }

    // --- DATA MAPPING (Adjusted for FreshData format) ---
    // They often return 'full_name', 'occupation', 'summary', 'experiences', 'education'
    let fullName = profileData.full_name || profileData.name || profileData.title || `${profileData.first_name} ${profileData.last_name}`;
    
    if (!fullName || fullName.includes("undefined") || fullName.length < 2) {
        fullName = getNameFromUrl(profileUrl);
    }
    
    const firstName = fullName.split(' ')[0] || "there";
    
    const headline = profileData.headline || profileData.occupation || "";
    const about = profileData.summary || profileData.about || "";
    
    // FreshData usually returns 'experiences' array and 'education' array
    const experienceRaw = profileData.experiences || profileData.work_experience || [];
    const educationRaw = profileData.education || [];
    
    // Posts might not be available in standard FreshData runs, so we rely on About/Headline
    const postsRaw = profileData.posts || []; 

    // Context for AI
    const summaryData = `
      Name: ${fullName}
      Current Role: ${headline}
      About Section: ${about}
      Career History: ${JSON.stringify(experienceRaw.slice(0, 3))}
      Education: ${JSON.stringify(educationRaw)}
      Recent Posts: ${JSON.stringify(postsRaw.slice(0, 2))}
    `;

    // --- DYNAMIC SYSTEM PROMPT ---
    const systemPrompt = `
      You are an expert networker. 
      
      CURRENT MODE: ${hasOffer ? "**SALES OUTREACH**" : "**PURE NETWORKING (NO SELLING)**"}

      **INPUTS:**
      - Lead Data: ${summaryData}
      - Extra Context (Ads/Tech Signals): "${customPrompt || "None"}"
      ${hasOffer ? `- My Offer to Bridge to: "${myOffer}"` : "- NO OFFER PROVIDED. DO NOT PITCH."}

      **YOUR TASK: SCAN FOR THESE "DEEP SIGNALS" IN THE TEXT:**
      1. **Company News:** Funding, IPO, Acquisitions mentioned in About/Experience.
      2. **Tech Stack:** Mentions of AWS, HubSpot, or "Tech Churn" (switching tools).
      3. **Podcasts:** Mentions of "Episode", "Host", or "Guest".
      4. **Role/Venture:** Specific past companies founded or led.

      ---------------------------------------------------------
      **LOGIC FLOW:**

      **IF MODE = PURE NETWORKING (No Offer provided):**
      - **Goal:** Be a genuine peer. Validate their work.
      - **Structure:** 1. Hi ${firstName},
        2. **Icebreaker:** specific observation about their [Signal/Venture/News].
        3. **Closing:** "Great to have you in my network." or "Love watching how you're scaling this."
      - **CRITICAL:** STOP THERE. Do NOT add "I'd love to chat about synergies" or any fluff. Keep it clean like: "Impressed by your journey with [Company]. Great to have you in my network."

      **IF MODE = SALES OUTREACH (Offer provided):**
      - **Goal:** Bridge the signal to the offer naturally.
      - **Structure:**
        1. Hi ${firstName},
        2. **Icebreaker:** Validate the [Signal].
        3. **Bridge:** "Usually, [Signal] brings challenges with [Problem my Offer solves]. We help teams [Value Prop]..."
        4. **Closing:** Soft ask.

      ---------------------------------------------------------
      **STRICT ANTI-ROBOT RULES:**
      1. **NEVER** say "I noticed a lack of recent activity." (Look at Headline/History instead).
      2. **NEVER** use generic phrases like "I hope this finds you well."
      3. **Search** the provided text deeply for the "Deep Signals" listed above.
      4. If "Pure Networking", the message must be under 30 words.

      **OUTPUT FORMAT (JSON ONLY):**
      {
        "icebreaker": "The specific observation",
        "message": "The final message based on the logic above."
      }
    `;

    let resultText = "";

    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey: apiKey });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You output valid JSON." },
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