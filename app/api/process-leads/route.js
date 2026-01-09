import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// Helper: Clean Name
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

    console.log(`\n--- PROCESSING: ${profileUrl} ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });
    
    // Using the 'dev_fusion' scraper (Standard for Paid Plans)
    const run = await apifyClient.actor("dev_fusion/linkedin-profile-scraper").call({
      profileUrls: [profileUrl],
    });

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    const profileData = items[0];

    // --- DATA MAPPING ---
    let fullName = profileData?.fullName || profileData?.name || `${profileData?.firstName} ${profileData?.lastName}`;
    if (!fullName || fullName.includes("undefined")) fullName = getNameFromUrl(profileUrl);
    
    const firstName = fullName.split(' ')[0] || "there";
    const headline = profileData?.headline || "";
    const about = profileData?.summary || profileData?.about || "";
    const postsRaw = profileData?.posts || [];
    const experienceRaw = profileData?.experience || [];

    // Context for AI
    const summaryData = `
      Name: ${fullName}
      Current Role: ${headline}
      About Section: ${about}
      Recent Posts: ${JSON.stringify(postsRaw.slice(0, 3))}
      Career History: ${JSON.stringify(experienceRaw.slice(0, 2))}
    `;

    // --- THE "HUMAN CONSULTANT" PROMPT ---
    const systemPrompt = `
      You are a senior business partner, NOT a sales bot. 
      
      YOUR GOAL:
      Write a message that sounds like it came from a peer who understands their specific business challenges.

      INPUTS:
      - **Lead:** ${summaryData}
      - **My Offer:** "${myOffer || "We help companies scale operations."}"
      
      ---------------------------------------------------------
      **STRATEGY: THE "PROBLEM-FIRST" BRIDGE**
      
      Instead of saying "I saw your profile," you must **INFER A PROBLEM** based on their role/industry and bridge it to the offer.

      **SCENARIO A: They have specific news (New Role, Funding, Post)**
      - *Logic:* Validate the news -> Mention the "hidden pain" of that good news -> Offer solution.
      - *Example:* "Saw the goal to mobilize 50k caregivers. Usually, the 'ops drag' hits hardest at this phase. We helped a similar group automate scheduling to handle that volume..."

      **SCENARIO B: Sparse Profile (No news)**
      - *Logic:* Look at their **Headine/Role**. What is the #1 headache for someone in that seat?
      - *Example (Targeting a CMO):* "Saw you're leading marketing at [Company]. With the current shift in ad spend efficiency, the challenge is often bridging brand awareness to actual revenue..."
      - *Example (Targeting a Founder):* "Building in the [Industry] space is tough right now with [Trend]. Usually, the bottleneck is..."

      ---------------------------------------------------------
      **STRICT "ANTI-BOT" RULES:**
      1. **NEVER** say "I noticed your profile is sparse." (Instant fail).
      2. **NEVER** say "I noticed we have mutual interests."
      3. **NEVER** use the word "synergy."
      4. **ALWAYS** separate the paragraphs. Visual spacing is human.

      **OUTPUT FORMAT (JSON ONLY):**
      {
        "icebreaker": "The observation or problem inference",
        "message": "Hi ${firstName},\n\n[Specific Observation/Inference].\n\n[The 'Bridge' - linking that problem to how we solved it for others].\n\n[Low friction ask]?"
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