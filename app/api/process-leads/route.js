import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

export async function POST(req) {
  try {
    const { apifyKey, apiKey, provider, profileUrl, myOffer, customPrompt } = await req.json();

    console.log(`\n--- PROCESSING: ${profileUrl} ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });
    console.log("Starting Scraper: dev_fusion/linkedin-profile-scraper...");
    
    const run = await apifyClient.actor("dev_fusion/linkedin-profile-scraper").call({
      profileUrls: [profileUrl],
    });

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    const profileData = items[0];

    if (!profileData) {
      console.error("❌ Apify returned no data!");
      throw new Error("Failed to scrape data. Please check the URL.");
    }

    // Map fields
    const fullName = profileData.fullName || (profileData.firstName + " " + profileData.lastName);
    const firstName = profileData.firstName || fullName.split(' ')[0] || "there";
    const headline = profileData.headline || "";
    const about = profileData.summary || profileData.about || "";
    const postsRaw = profileData.posts || [];
    const experienceRaw = profileData.experience || [];
    const educationRaw = profileData.education || [];
    const location = profileData.location || "";

    // Prepare Context
    const summaryData = `
      Name: ${fullName}
      Headline: ${headline}
      Location: ${location}
      About: ${about} 
      LATEST ACTIVITY (Look for Hiring, Funding, Product news): 
      ${JSON.stringify(postsRaw.slice(0, 5))}
      CAREER HISTORY (Look for Promotions, Tenure, Role Changes): 
      ${JSON.stringify(experienceRaw.slice(0, 3))}
      EDUCATION (Look for Alumni): 
      ${JSON.stringify(educationRaw)}
    `;

    console.log("✅ Data Mapped Successfully for:", fullName);

    // SYSTEM PROMPT: THE "MASTER SIGNAL" BRAIN
    const systemPrompt = `
      You are an elite SDR Strategist with access to a "Master Signal Database."
      
      YOUR GOAL: 
      Analyze the provided LinkedIn data (and any user context) to find the STRONGEST signal from the list below. Then, write a hyper-personalized connection request connecting that signal to "MY OFFER."

      1. INPUTS:
      - **Lead Profile:** \n${summaryData}
      - **My Offer:** "${myOffer}"
      - **User Context:** "${customPrompt || ""}" (Check here for manual signals like G2/Ads/Tech Stack)

      2. MASTER SIGNAL DATABASE (Your Menu of Strategies):
      
      [TIER 1: HIGH CONVERSION - "INTENT & TIMING"] (Use if User Context provides data)
      - **Competitor Reviews:** "Saw a user mention [Competitor] struggle on G2..."
      - **Tech Churn:** "Noticed you dropped [Tool]..."
      - **Category Intent:** "Our data shows high activity researching [Category]..."

      [TIER 2: STRATEGIC SHIFTS] (Infer from Posts/Headline)
      - **New Ads:** "Saw your new LinkedIn/Meta ads for [Product]..."
      - **Pixel Install:** "Saw you added TikTok pixel -> doubling down on Gen-Z?"
      - **Job Description Change:** "Added 'Outbound' to AE role -> shifting to hunter mentality?"

      [TIER 3: PROFESSIONAL GROWTH] (Auto-Detect from LinkedIn Data)
      - **Company News:** Funding, IPO, Acquisition.
      - **Product Launch:** "Signals innovation/gaps in support."
      - **Hiring/Expansion:** "Hiring VPs implies need for process tooling."
      - **Headcount:** "Managing 500+ people creates scalability challenges."

      [TIER 4: THOUGHT LEADERSHIP] (Auto-Detect from Posts)
      - **Recent Post:** Quote specific insight.
      - **Podcast:** "Heard your episode on [Name]..."
      - **Keywords:** "Noticed 'Revenue Ops' in your bio..."

      [TIER 5: PERSONAL BACKGROUND] (Auto-Detect from History/Education)
      - **Job Change/Promo:** "Congrats on the move."
      - **Tenure:** "With 10+ years in Fintech..."
      - **Alumni/Location:** Shared college or "Top rated restaurant in [City]."

      [TIER 6: INFERRED CREATIVE (LEVEL 4)] (The "Smartest" Strategy)
      - **Inferred Problem:** "Hiring 10 reps usually breaks onboarding."
      - **Customer Suggestion:** Propose idea for *their* customers.
      - **Phone Fail:** "Tried calling but couldn't get through..."

      3. YOUR TASK:
      - **SCAN:** Look at the LinkedIn Data. Do you see a Tier 3, 4, or 5 signal?
      - **CHECK:** Did the user provide a Tier 1 or 2 signal in the "User Context"?
      - **SELECT:** Pick the ONE strongest signal.
      - **DRAFT:** - Start with "Hi ${firstName},"
        - **Icebreaker:** Validate the signal (Don't just state it. Validate the *impact*).
        - **Bridge:** Connect the signal to "My Offer" using the "Level 4" logic (Problem -> Solution).
        - **Close:** Low pressure.

      4. OUTPUT FORMAT (JSON ONLY):
      {
        "strategy_selected": "Name of signal used (e.g. 'Tier 3 - Hiring Expansion')",
        "icebreaker": "The specific hook",
        "message": "The full message."
      }
    `;

    let resultText = "";

    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey: apiKey });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a smart sales strategist that outputs JSON." },
          { role: "user", content: systemPrompt },
        ],
        temperature: 0.75, 
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
      strategy: parsedResult.strategy_selected,
      icebreaker: parsedResult.icebreaker,
      message: parsedResult.message
    });

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "Something went wrong" }, { status: 500 });
  }
}