"use client";
import { useState } from 'react';
import { Copy, Loader2, Play, Table as TableIcon, Bot, Cpu, Trash2 } from 'lucide-react';

export default function Home() {
  const [apifyKey, setApifyKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('openai');
  const [leadInput, setLeadInput] = useState('');
  
  // THE BRAIN INPUTS
  const [myOffer, setMyOffer] = useState(''); 
  const [customPrompt, setCustomPrompt] = useState(''); 
  
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('');

  const handleStart = async () => {
    if (!apifyKey || !apiKey || !leadInput) {
      alert("Please fill in API Keys and Leads.");
      return;
    }

    setLoading(true);
    const urls = leadInput.split('\n').filter(url => url.trim() !== '');

    for (const url of urls) {
      setCurrentStatus(`Thinking with ${provider === 'openai' ? 'OpenAI' : 'Gemini'}: ${url}...`);
      
      try {
        const response = await fetch('/api/process-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            apifyKey, 
            apiKey,
            provider, 
            profileUrl: url.trim(),
            myOffer,      
            customPrompt
          }),
        });

        const data = await response.json();

        if (data.error) {
          setResults(prev => [...prev, { name: "Error", profileUrl: url, icebreaker: "Failed", message: data.error }]);
        } else {
          setResults(prev => [...prev, data]);
        }

      } catch (err) {
        console.error(err);
      }
    }

    setCurrentStatus('Completed!');
    setLoading(false);
  };

  const copyTable = () => {
    const headers = ["Name", "Profile URL", "Icebreaker", "Message"];
    const rows = results.map(row => {
      const clean = (text) => (text || "").toString().replace(/\t/g, " ").replace(/\n/g, " ").trim();
      return [
        clean(row.name),
        clean(row.profileUrl),
        clean(row.icebreaker),
        clean(row.message)
      ].join("\t");
    });
    const tsvData = [headers.join("\t"), ...rows].join("\n");
    navigator.clipboard.writeText(tsvData);
    alert("Table copied! Paste into Excel/Sheets.");
  };

  const clearTable = () => {
    if (confirm("Clear results?")) {
      setResults([]);
      setCurrentStatus('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        <div className="text-center">
          <h1 className="text-3xl font-bold text-blue-800">LinkedIn Icebreaker Generator</h1>
          <p className="text-gray-500 mt-2">Autonomous "Level 4" Personalization Engine</p>
        </div>

        {/* Configuration Panel */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">1. Select AI Model</label>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setProvider('openai')} className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${provider === 'openai' ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                  <Bot size={20} /> OpenAI (GPT-4)
                </button>
                <button onClick={() => setProvider('gemini')} className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${provider === 'gemini' ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                  <Cpu size={20} /> Gemini (Flash)
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-semibold text-gray-700">2. Enter API Keys</label>
              <input type="password" placeholder="Apify API Key" className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm placeholder-gray-500 text-gray-900" value={apifyKey} onChange={(e) => setApifyKey(e.target.value)} />
              <input type="password" placeholder={provider === 'openai' ? "OpenAI API Key" : "Gemini API Key"} className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm placeholder-gray-500 text-gray-900" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>

            {/* THE BRAIN: OFFER CONTEXT */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-blue-700">3. My Offer / Value Prop</label>
              <textarea 
                placeholder="What are you selling? (e.g. 'We help Series B startups scale engineering squads...')" 
                className="w-full h-32 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm placeholder-gray-500 text-gray-900 bg-blue-50/50 border-blue-100" 
                value={myOffer} 
                onChange={(e) => setMyOffer(e.target.value)} 
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">4. Lead Sheet (Paste URLs)</label>
              <textarea placeholder="Paste LinkedIn Profile URLs here..." className="w-full h-48 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono placeholder-gray-500 text-gray-900" value={leadInput} onChange={(e) => setLeadInput(e.target.value)} />
            </div>
             <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">5. Extra Instructions (Optional)</label>
              <textarea placeholder="E.g., Keep it under 40 words, use a witty tone..." className="w-full h-24 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm placeholder-gray-500 text-gray-900" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <button onClick={handleStart} disabled={loading} className={`flex items-center gap-2 px-8 py-3 rounded-full text-white font-semibold shadow-lg transition-all ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:scale-105'}`}>
            {loading ? <><Loader2 className="animate-spin" /> Analyzing...</> : <><Play size={20} /> Generate Icebreakers</>}
          </button>
        </div>
        
        {loading && <p className="text-center text-sm text-gray-500 animate-pulse font-medium">{currentStatus}</p>}

        {results.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
              <h3 className="font-bold text-gray-700 flex items-center gap-2"><TableIcon size={18}/> Results ({results.length})</h3>
              <div className="flex gap-2">
                <button onClick={clearTable} className="flex items-center gap-2 text-sm bg-red-100 text-red-600 px-4 py-2 rounded hover:bg-red-200 transition"><Trash2 size={16} /> Clear</button>
                <button onClick={copyTable} className="flex items-center gap-2 text-sm bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition shadow-sm"><Copy size={16} /> Copy to Clipboard</button>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-100 text-gray-600 uppercase text-xs font-bold">
                  <tr>
                    <th className="p-4">Name</th>
                    <th className="p-4">Profile</th>
                    <th className="p-4 w-1/3">Icebreaker</th>
                    <th className="p-4 w-1/3">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map((row, index) => (
                    <tr key={index} className="hover:bg-blue-50 transition-colors">
                      <td className="p-4 font-medium text-gray-800">{row.name}</td>
                      <td className="p-4"><a href={row.profileUrl} target="_blank" className="text-blue-600 hover:underline truncate block max-w-[150px]">Link</a></td>
                      <td className="p-4 text-gray-700 leading-relaxed">{row.icebreaker}</td>
                      <td className="p-4 text-gray-600 italic bg-gray-50/50 leading-relaxed whitespace-pre-wrap">{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}