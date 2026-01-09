import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// HELPER: Extract Name from URL if Scraper Fails
// (e.g. "https://linkedin.com/in/abhay-suman" -> "Abhay Suman")
function getNameFromUrl(url) {
  try {
    if (!url) return "there";
    const slug = url.split('/in/')[1]?.split('/')[0] || "";
    // Remove numbers at the end (common in LinkedIn URLs) and capitalize
    const cleanedSlug = slug.replace(/-[\d\w]+$/, '').replace(/-/g, ' '); 
    return cleanedSlug.replace(/\b\w/g, l => l.toUpperCase()) || "there";
  } catch (e) {
    return "there";
  }
}

export async function POST(req) {
  try {
    // No cookie needed here!
    const { apifyKey, apiKey, provider, profileUrl, customPrompt, myOffer } = await req.json();

    console.log(`\n--- PROCESSING: ${profileUrl} ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });

    console.log("Starting Scraper: rocky/linkedin-profile-scraper (No Cookie Mode)...");
    
    // Using 'rocky' which works great on paid plans without cookies
    const run = await apifyClient.actor("rocky/linkedin-profile-scraper").call({
      profileUrls: [profileUrl],
      deepScrape: true, // This ensures we get the "About" and "Posts" sections
    });

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    const profileData = items[0];

    // --- 1. ROBUST NAME EXTRACTION ---
    // Rocky sometimes puts the name in 'name', 'fullName', or even 'title'
    let fullName = profileData?.fullName || profileData?.name || profileData?.title;
    
    // Fallback: If Apify gave us nothing, get name from the URL
    if (!fullName || fullName === "undefined undefined" || fullName === "null null") {
      console.log("⚠️ Name missing in data. Extracting from URL...");
      fullName = getNameFromUrl(profileUrl);
    }
    
    const firstName = fullName.split(' ')[0] || "there";

    if (!profileData) {
        console.log("⚠️ Scraper returned empty object. Using URL fallback completely.");
    }

    // --- 2. DATA MAPPING (Fixing the "Undefined" bug) ---
    // Rocky uses 'activities' for posts and 'positions' for experience
    const headline = profileData?.headline || profileData?.sub_title || "";
    const about = profileData?.summary || profileData?.about || "";
    
    const postsRaw = profileData?.activities || profileData?.posts || [];
    const experienceRaw = profileData?.positions || profileData?.experience || [];
    const educationRaw = profileData?.education || [];

    // Prepare Context
    const summaryData = `
      Name: ${fullName}
      Headline: ${headline}
      About: ${about} 
      LATEST ACTIVITY: ${JSON.stringify(postsRaw.slice(0, 3))}
      CAREER HISTORY (Look for Ventures/Roles): ${JSON.stringify(experienceRaw.slice(0, 3))}
      EDUCATION (Look for Awards/Alumni): ${JSON.stringify(educationRaw)}
    `;

    console.log("✅ Mapped Data for:", fullName);

    // --- 3. SYSTEM PROMPT: SPECIFICITY FIRST ---
    const systemPrompt = `
      You are an expert networker doing cold outreach.
      
      LEAD DATA:
      ${summaryData}

      YOUR CONTEXT/OFFER:
      ${myOffer || "We help companies scale efficiently."}

      YOUR GOAL:
      Write a short, high-impact connection request.
      
      CRITICAL INSTRUCTION:
      **Do NOT be generic.** Do NOT say "I noticed a lack of activity." 
      If they haven't posted recently, look at their **Headline**, **Experience**, or **About** section to find specific achievements like:
      - Specific past ventures (e.g. "Impressed by how you built GoKratos")
      - Awards (e.g. "Congrats on the Forbes 30U30 feature")
      - Specific roles (e.g. "Leading FoxTale as Founder is impressive")

      STEP 1: THE ICEBREAKER
      - Reference the MOST impressive specific detail found in the data.
      - Be direct. (e.g. "Your work bridging clinical care with research at EpiSoft is commendable.")

      STEP 2: THE MESSAGE
      - Start with: "Hi ${firstName},"
      - Insert the Icebreaker.
      - Add a "Bridge": A genuine professional reason to connect related to YOUR OFFER.
      - Close: "Great to have you in my network." or "Would love to connect."

      USER CUSTOM CONDITIONS:
      ${customPrompt || ""}

      OUTPUT FORMAT (JSON ONLY):
      {
        "icebreaker": "The specific 1-sentence observation",
        "message": "Hi ${firstName}, [Icebreaker]. [Bridge]. [Close]."
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