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
    const { apifyKey, apiKey, provider, profileUrl, customPrompt } = await req.json();

    console.log(`\n--- PROCESSING: ${profileUrl} ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });
    
    // USING 'freshdata/fresh-linkedin-profile-data'
    // This is the best alternative since 'rocky' is gone and 'dev_fusion' blocked the API.
    // Ensure you added it here: https://apify.com/freshdata/fresh-linkedin-profile-data
    console.log("Starting Scraper: freshdata/fresh-linkedin-profile-data...");
    
    const run = await apifyClient.actor("freshdata/fresh-linkedin-profile-data").call({
      linkedin_url: profileUrl,
      url: profileUrl
    });

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    
    // FreshData wraps result in .data usually
    const rawItem = items[0];
    const profileData = rawItem?.data || rawItem;

    if (!profileData) {
        throw new Error("Scraper finished but returned no data. Profile might be private.");
    }

    // --- DATA MAPPING ---
    let fullName = profileData.full_name || profileData.name || profileData.title || `${profileData.first_name} ${profileData.last_name}`;
    
    if (!fullName || fullName.includes("undefined") || fullName.length < 2) {
        fullName = getNameFromUrl(profileUrl);
    }
    
    const firstName = fullName.split(' ')[0] || "there";
    const headline = profileData.headline || profileData.occupation || "";
    const about = profileData.summary || profileData.about || "";
    const experienceRaw = profileData.experiences || profileData.work_experience || [];
    const educationRaw = profileData.education || [];
    const postsRaw = profileData.posts || []; 

    // Context for AI
    const summaryData = `
      Name: ${fullName}
      Current Role: ${headline}
      About Section: ${about}
      Career History: ${JSON.stringify(experienceRaw.slice(0, 3))}
      Recent Posts: ${JSON.stringify(postsRaw.slice(0, 2))}
    `;

    // --- DYNAMIC INDUSTRY PEER PROMPT ---
    const systemPrompt = `
      You are a professional networker. 
      
      YOUR GOAL:
      Write a warm, specific connection request that sounds like it comes from a peer in the same industry.

      INPUTS:
      - Lead Data: ${summaryData}
      - External Signals (Ads/Tech): "${customPrompt || "None"}"

      **STEP 1: ANALYZE THE INDUSTRY**
      Look at their Headline, Summary, and History. What is their SPECIFIC field?
      - Bad: "Business"
      - Good: "Supply Chain", "FinTech", "SaaS Sales", "Cloud Infrastructure", "D2C Marketing".
      -> Save this as [INDUSTRY].

      **STEP 2: FIND THE ICEBREAKER (The "Deep Signal")**
      Scan for:
      1. **News:** Funding/Acquisitions mentioned.
      2. **Content:** A specific insight from their post or about section.
      3. **Venture:** A past company they founded or led.
      4. **Role:** "Leading [Company] as [Role] is impressive."
      *Constraint:* Keep the icebreaker under 20 words.

      **STEP 3: COMPOSE THE MESSAGE**
      Follow this EXACT structure:
      "Hi ${firstName}, [Icebreaker]. Always great to connect with others deep in the [INDUSTRY] space. Would love to connect."

      **RULES:**
      - No selling. No pitching.
      - [INDUSTRY] must be specific to them (e.g. "supply chain", "generative AI", "commercial real estate").
      - Do not use generic filler like "I hope you are well."

      **OUTPUT FORMAT (JSON ONLY):**
      {
        "icebreaker": "The specific observation used",
        "message": "The final message string."
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