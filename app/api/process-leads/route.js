import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// HELPER: Extract Name from URL (Fallback)
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

    console.log(`\n--- 1. STARTING PROCESS: ${profileUrl} ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });

    // SWITCHING TO 'ROCKY' (Reliable for Paid Plans)
    console.log("--- 2. CALLING APIFY (rocky/linkedin-profile-scraper) ---");
    
    const run = await apifyClient.actor("rocky/linkedin-profile-scraper").call({
      profileUrls: [profileUrl],
      deepScrape: true, // Ask for more data (Posts, etc.)
    });

    console.log("--- 3. FETCHING RESULTS ---");
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    
    // DEBUG: Print the raw data to console to see if it worked
    if (items.length > 0) {
      console.log("✅ RAW DATA RECEIVED. Keys found:", Object.keys(items[0]));
    } else {
      console.error("❌ APIFY RETURNED EMPTY LIST. Check if Profile is Public.");
      throw new Error("Scraper finished but returned no profiles. Profile might be private.");
    }

    const profileData = items[0];

    // --- 4. ROBUST MAPPING (Handle different scraper formats) ---
    
    // NAME
    let fullName = profileData.fullName || profileData.name || profileData.title; // Rocky sometimes puts name in title
    if (!fullName || fullName === "undefined undefined") {
      console.log("⚠️ Name missing in data. extracting from URL...");
      fullName = getNameFromUrl(profileUrl);
    }
    const firstName = fullName.split(' ')[0] || "there";

    // HEADLINE & ABOUT
    const headline = profileData.headline || profileData.sub_title || "";
    const about = profileData.summary || profileData.about || "";
    
    // POSTS (Rocky often puts them in 'posts' or 'activities')
    const postsRaw = profileData.posts || profileData.activities || [];
    
    // EXPERIENCE (Rocky uses 'positions' or 'experience')
    const experienceRaw = profileData.positions || profileData.experience || [];
    
    // EDUCATION
    const educationRaw = profileData.education || [];

    // DEBUG: Print what we found
    console.log(`--- 5. MAPPED DATA ---`);
    console.log(`Name: ${fullName}`);
    console.log(`Headline: ${headline.substring(0, 30)}...`);
    console.log(`Posts Found: ${postsRaw.length}`);
    console.log(`Jobs Found: ${experienceRaw.length}`);

    // Prepare Context for AI
    const summaryData = `
      Name: ${fullName}
      Headline: ${headline}
      About: ${about.substring(0, 500)}...
      
      LATEST ACTIVITY: 
      ${JSON.stringify(postsRaw.slice(0, 3))}
      
      CAREER HISTORY (Positions): 
      ${JSON.stringify(experienceRaw.slice(0, 3))}
      
      EDUCATION: 
      ${JSON.stringify(educationRaw)}
    `;

    // --- 6. INTELLIGENT PROMPT (Using your specific strategy) ---
    const systemPrompt = `
      You are an elite SDR doing deep research.
      
      LEAD DATA:
      ${summaryData}

      YOUR OFFER / CONTEXT:
      ${myOffer || "We help companies scale efficiently."}

      GOAL:
      Write a short, Specific, "Level 4" Connection Request.

      STRATEGY:
      1. **Scan for Specificity:** Look for exact company names, awards (Forbes), specific posts, or growth metrics in the data.
      2. **The "Icebreaker":**
         - If they have a recent post: Quote the main insight.
         - If NO recent post: Look at **Experience** or **About**. Mention a specific venture, acquisition, or role transition. (e.g. "Impressed by your exit at [Company]").
         - *Never* say "I noticed you haven't posted." Find something else positive to validate.
      3. **The "Bridge":** Connect that specific achievement to my offer naturally.
      
      OUTPUT JSON:
      {
        "strategy": "e.g. Past Venture / Recent Post",
        "icebreaker": "The 1-sentence specific observation",
        "message": "Hi ${firstName}, [Icebreaker]. [Bridge]. [Short Close]."
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
      strategy: parsedResult.strategy,
      icebreaker: parsedResult.icebreaker,
      message: parsedResult.message
    });

  } catch (error) {
    console.error("❌ API ERROR:", error);
    return NextResponse.json({ error: error.message || "Something went wrong" }, { status: 500 });
  }
}