import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanJson(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// Helper: Clean Name from URL if scraper fails
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
    const { apifyKey, apiKey, provider, profileUrl, customPrompt, myOffer } = await req.json();

    console.log(`\n--- PROCESSING: ${profileUrl} ---`);

    const apifyClient = new ApifyClient({ token: apifyKey });
    
    // Using 'dev_fusion' scraper (Standard for Paid Plans)
    const run = await apifyClient.actor("dev_fusion/linkedin-profile-scraper").call({
      profileUrls: [profileUrl],
    });

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    const profileData = items[0];

    // --- DATA MAPPING ---
    // 1. First Name Extraction (Prioritize Scraper -> Fallback to URL)
    let fullName = profileData?.fullName || profileData?.name || `${profileData?.firstName} ${profileData?.lastName}`;
    if (!fullName || fullName.includes("undefined") || fullName.length < 2) {
        fullName = getNameFromUrl(profileUrl);
    }
    
    // Ensure we have a clean First Name for the greeting
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
      - **Lead Profile:** ${summaryData}
      - **External Signals (User Context):** "${customPrompt || "None provided"}" (Look here for Ad Library, Tech Stack, or Churn data).
      - **My Offer:** "${myOffer || "We help companies scale operations."}"
      
      ---------------------------------------------------------
      **STRATEGY: THE "PROBLEM-FIRST" BRIDGE**
      
      **PRIORITY 1: EXTERNAL HIGH-INTENT SIGNALS (If found in User Context)**
      - **Ad Library Launch:** If context mentions new ads -> "Just saw your new ad creatives for [Product] on LinkedIn—love the angle on [Value Prop]."
      - **Tech Stack Churn:** If context mentions dropping a tool -> "Noticed you recently stopped using [Competitor Tool]. Usually, that means teams are looking for something more scalable..."
      - **Tech Stack Install:** If context mentions using a tool -> "Saw you use [Tool], which usually implies you are focused on [Goal]..."
      - **Podcast Appearance:** If context/profile mentions a podcast -> "Heard your episode on [Podcast Name]..."

      **PRIORITY 2: PROFILE SIGNALS (Company News / Posts)**
      - **Company News:** Funding/IPO/Acquisition -> "Big news on the [Funding/Event]. Usually, the 'ops drag' hits hardest at this specific growth phase."
      - **Recent Post:** Quote their specific insight -> "Your point about [Topic] was spot on."

      **PRIORITY 3: SPARSE PROFILE (No news/signals)**
      - *Logic:* Look at their **Headine/Role**. What is the #1 headache for someone in that seat?
      - *Example:* "Leading marketing at [Company] right now is tough—bridging brand awareness to actual revenue is the common bottleneck..."

      ---------------------------------------------------------
      **STRICT "ANTI-BOT" RULES:**
      1. **NEVER** say "I noticed your profile is sparse." (Instant fail).
      2. **NEVER** say "I noticed we have mutual interests."
      3. **NEVER** use the word "synergy."
      4. **ALWAYS** separate the paragraphs. Visual spacing is human.
      5. **ALWAYS** use the extracted First Name: "${firstName}".

      **OUTPUT FORMAT (JSON ONLY):**
      {
        "icebreaker": "The observation or problem inference",
        "message": "Hi ${firstName},\n\n[Specific Observation/Icebreaker].\n\n[The 'Bridge' - linking that signal to how we solved it/My Offer].\n\n[Low friction ask]?"
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