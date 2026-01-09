import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// HELPER: Extract Name from URL if Scraper Fails
function getNameFromUrl(url) {
  try {
    if (!url) return "there";
    const slug = url.split('/in/')[1]?.split('/')[0] || "";
    // Remove numbers at end, replace dashes with spaces, Capitalize
    const cleanedSlug = slug.replace(/-[\d\w]+$/, '').replace(/-/g, ' '); 
    return cleanedSlug.replace(/\b\w/g, l => l.toUpperCase()) || "there";
  } catch (e) {
    return "there";
  }
}

export async function POST(req) {
  try {
    // 1. Receive Inputs (No Cookies needed!)
    const { apifyKey, apiKey, provider, profileUrl, customPrompt, myOffer } = await req.json();

    console.log(`\n--- PROCESSING: ${profileUrl} ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });

    // 2. USE THE CORRECT PAID ACTOR (No Cookies)
    // Make sure you visited https://apify.com/dev_fusion/linkedin-profile-scraper and clicked "Try" once!
    console.log("Starting Scraper: dev_fusion/linkedin-profile-scraper...");
    
    const run = await apifyClient.actor("dev_fusion/linkedin-profile-scraper").call({
      profileUrls: [profileUrl],
    });

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    const profileData = items[0];

    if (!profileData) {
      console.error("❌ Apify returned no data!");
      throw new Error("Failed to scrape data. Profile might be private.");
    }

    // 3. ROBUST DATA MAPPING
    // DevFusion puts name in 'fullName'. If missing, check 'firstName' + 'lastName'.
    let fullName = profileData.fullName || `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim();
    
    // Fallback: Extract from URL if API failed
    if (!fullName || fullName === "undefined undefined" || fullName.length < 2) {
      console.log("⚠️ Name missing in data. Extracting from URL...");
      fullName = getNameFromUrl(profileUrl);
    }
    
    const firstName = fullName.split(' ')[0] || "there";

    // Map other fields
    const headline = profileData.headline || "";
    const about = profileData.summary || profileData.about || "";
    const postsRaw = profileData.posts || [];
    const experienceRaw = profileData.experience || [];
    const educationRaw = profileData.education || [];

    // 4. PREPARE CONTEXT (Targeting "Specific" Details)
    const summaryData = `
      Name: ${fullName}
      Headline: ${headline}
      About: ${about.substring(0, 600)}...
      
      LATEST POSTS: 
      ${JSON.stringify(postsRaw.slice(0, 3))}
      
      CAREER HISTORY (Look for Ventures, Exits, Roles): 
      ${JSON.stringify(experienceRaw.slice(0, 3))}
      
      EDUCATION (Look for Awards/Alumni): 
      ${JSON.stringify(educationRaw)}
    `;

    console.log("✅ Data Mapped for:", fullName);

    // 5. SYSTEM PROMPT: "LEVEL 4" SPECIFICITY
    const systemPrompt = `
      You are an expert SDR doing cold outreach.
      
      LEAD DATA:
      ${summaryData}

      YOUR CONTEXT/OFFER:
      ${myOffer || "We help companies scale."}

      YOUR GOAL:
      Write a specific, high-impact connection request.
      
      CRITICAL RULE:
      **NO GENERIC FILLER.** Never say "I noticed a lack of activity" or "I see we have mutual interests."
      
      STEP 1: FIND THE "HOOK" (Priority Order)
      1. **Specific Venture/Result:** Did they build a specific company? (e.g. "Leading FoxTale to ₹300Cr...")
      2. **Award/Recognition:** (e.g. "Congrats on the Forbes 30U30 feature...")
      3. **Recent Post:** Quote a specific insight they shared.
      4. **Role Scope:** (e.g. "Your work bridging clinical care with research at EpiSoft is commendable.")

      STEP 2: WRITE THE MESSAGE
      - Start with: "Hi ${firstName},"
      - **Icebreaker:** One sentence validating the specific hook found above.
      - **Bridge:** A natural transition to your offer. (e.g. "Love watching how you're scaling this.", "Great to see leaders driving innovation in [Industry].")
      - **Close:** "Great to have you in my network."

      USER CUSTOM CONDITIONS:
      ${customPrompt || ""}

      OUTPUT FORMAT (JSON ONLY):
      {
        "icebreaker": "The specific observation",
        "message": "Hi ${firstName}, [Icebreaker]. [Bridge]. [Close]."
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