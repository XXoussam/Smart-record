import React, { useState } from 'react';
import { generateSocialPost } from '../services/geminiService';
import { Sparkles, Copy, Check, Instagram, Loader2 } from 'lucide-react';

export const GeminiCaption: React.FC = () => {
  const [description, setDescription] = useState('');
  const [generatedCaption, setGeneratedCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!description) return;
    setLoading(true);
    try {
      const result = await generateSocialPost(description, 'Instagram');
      setGeneratedCaption(result || "No caption generated.");
    } catch (e) {
      setGeneratedCaption("Error generating caption. Check API Key.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedCaption);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-gray-800/50 p-6 rounded-xl border border-gray-700 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-purple-400" />
        <h3 className="text-lg font-semibold text-white">AI Assistant</h3>
      </div>
      
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1 font-medium">Describe your recording</label>
          <textarea
            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-2 focus:ring-purple-500 focus:outline-none transition-all placeholder-gray-600 resize-none"
            rows={3}
            placeholder="e.g. A coding tutorial showing how to center a div using CSS grid..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading || !description}
          className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Instagram className="w-4 h-4" />}
          {loading ? "Thinking..." : "Generate Social Caption"}
        </button>

        {generatedCaption && (
          <div className="relative mt-4 bg-gray-900 p-4 rounded-lg border border-gray-700 animate-in fade-in slide-in-from-top-2">
            <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans">{generatedCaption}</pre>
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 p-1.5 hover:bg-gray-700 rounded-md transition-colors text-gray-400 hover:text-white"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
