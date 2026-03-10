/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  Video, 
  Image as ImageIcon, 
  Loader2, 
  ArrowRight, 
  Play, 
  Plus, 
  Minus,
  Sparkles,
  History,
  LayoutGrid,
  SplitSquareVertical,
  Copy,
  Check,
  Languages,
  Facebook,
  Settings2,
  Clock,
  Youtube,
  Link as LinkIcon,
  Key,
  Eye,
  EyeOff,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface SceneAnalysis {
  timestamp: string;
  description: string;
  imagePrompt: string;
  changeType: string;
  indonesianTranslation: string;
  transformationPrompt?: string;
  transformationIndonesianTranslation?: string;
}

interface AnalysisResult {
  title: string;
  summary: string;
  scenes: SceneAnalysis[];
}

// --- Components ---

export default function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [clipCount, setClipCount] = useState<number>(3);
  const [analysisMode, setAnalysisMode] = useState<'normal' | 'semi-timelapse' | 'timelapse'>('semi-timelapse');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  
  // API Key States
  const [userApiKey, setUserApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Load API Key from localStorage on mount
  React.useEffect(() => {
    const savedKey = localStorage.getItem('gemini_user_api_key');
    if (savedKey) setUserApiKey(savedKey);
  }, []);

  // Save API Key to localStorage when it changes
  const handleApiKeyChange = (val: string) => {
    setUserApiKey(val);
    localStorage.setItem('gemini_user_api_key', val);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setVideoFile(file);
      setVideoUrl('');
      setVideoPreview(URL.createObjectURL(file));
      setResult(null);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    multiple: false
  });

  const handleAnalyze = async () => {
    if (!videoFile && !videoUrl) {
      setError("Please upload a video or provide a Facebook/YouTube link.");
      return;
    }

    const apiKey = userApiKey || import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      setError("API Key is missing. Please provide your own Gemini API Key in the settings below.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const contents: any[] = [];

      if (videoFile) {
        const base64Video = await fileToBase64(videoFile);
        contents.push({
          inlineData: {
            mimeType: videoFile.type,
            data: base64Video
          }
        });
      }

      const modeInstructions = {
        'normal': 'Focus on standard scene transitions and narrative flow.',
        'semi-timelapse': 'Focus on significant progress steps with moderate intervals, highlighting key construction or change phases.',
        'timelapse': 'Focus on rapid progression, capturing only the most dramatic changes between the start and end states.'
      };

      contents.push({
        text: `Analyze this video ${videoUrl ? `from this link: ${videoUrl}` : ''} and identify exactly ${clipCount} key scenes that represent a progression, timelapse, or before/after transformation. 
        
        ANALYSIS MODE: ${analysisMode.toUpperCase()}
        Instruction for this mode: ${modeInstructions[analysisMode]}

        For each scene, provide:
        1. A timestamp (approximate).
        2. A brief description of what changed.
        3. A highly detailed text-to-image prompt that would recreate this specific scene visually, focusing on the visual evolution.
        4. The type of change (e.g., "Initial State", "Transformation", "Final Result").
        5. A natural Indonesian translation of the image prompt.
        6. For all scenes except the last one, provide an "image-to-video" transformation prompt that describes the visual transition from this scene to the next. Focus specifically on exterior/interior architectural changes and the activity/presence of workers (pekerja) during the transformation.
        7. Provide a natural Indonesian translation of the transformation prompt.
        
        Return the result in JSON format.`
      });
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
        config: {
          tools: videoUrl ? [{ googleSearch: {} }] : undefined,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timestamp: { type: Type.STRING },
                    description: { type: Type.STRING },
                    imagePrompt: { type: Type.STRING },
                    changeType: { type: Type.STRING },
                    indonesianTranslation: { type: Type.STRING },
                    transformationPrompt: { type: Type.STRING, description: "Prompt for image-to-video transition to the next scene" },
                    transformationIndonesianTranslation: { type: Type.STRING, description: "Indonesian translation of the transformation prompt" }
                  },
                  required: ["timestamp", "description", "imagePrompt", "changeType", "indonesianTranslation"]
                }
              }
            },
            required: ["title", "summary", "scenes"]
          }
        }
      });

      const parsedResult = JSON.parse(response.text || "{}") as AnalysisResult;
      setResult(parsedResult);
    } catch (err) {
      console.error(err);
      setError("Failed to analyze video. Please ensure the file is not too large and try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTranslationChange = (index: number, value: string) => {
    if (!result) return;
    const newScenes = [...result.scenes];
    newScenes[index] = { ...newScenes[index], indonesianTranslation: value };
    setResult({ ...result, scenes: newScenes });
  };

  const handleTransformationTranslationChange = (index: number, value: string) => {
    if (!result) return;
    const newScenes = [...result.scenes];
    newScenes[index] = { ...newScenes[index], transformationIndonesianTranslation: value };
    setResult({ ...result, scenes: newScenes });
  };

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  return (
    <div className="min-h-screen data-grid p-4 md:p-8 lg:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-800 pb-8">
          <div>
            <div className="flex items-center gap-2 text-emerald-500 mb-2">
              <History className="w-5 h-5" />
              <span className="text-xs font-mono uppercase tracking-widest">Temporal Analysis Engine</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tighter text-white">
              VIDI<span className="text-zinc-500">LAPSE</span>
            </h1>
            <p className="text-zinc-400 mt-2 max-w-md">
              Deconstruct video narratives into high-fidelity scene progressions and generative prompts.
            </p>
          </div>
          
          <div className="flex flex-col gap-4">
            {/* API Key Input Section */}
            <div className="glass-panel p-3 space-y-2 min-w-[300px]">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono text-zinc-500 uppercase flex items-center gap-2">
                  <Key className="w-3 h-3" /> Your Gemini API Key
                </label>
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-[9px] font-mono text-emerald-500 hover:underline flex items-center gap-1"
                >
                  GET KEY <ExternalLink className="w-2 h-2" />
                </a>
              </div>
              <div className="relative">
                <input 
                  type={showApiKey ? "text" : "password"}
                  value={userApiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder="Enter your API Key..."
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/50 transition-colors pr-8"
                />
                <button 
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                >
                  {showApiKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-[9px] text-zinc-600 italic">
                *Saved locally in your browser. Leave empty to use system default.
              </p>
            </div>

            <div className="glass-panel px-4 py-2 flex items-center gap-4 self-end">
              <span className="text-xs font-mono text-zinc-500 uppercase">Target Clips</span>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setClipCount(Math.max(2, clipCount - 1))}
                  className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-400"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-xl font-mono font-bold w-6 text-center">{clipCount}</span>
                <button 
                  onClick={() => setClipCount(Math.min(10, clipCount + 1))}
                  className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-400"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Upload & Control */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Video Link Input */}
            <section className="space-y-4">
              <h2 className="text-sm font-mono text-zinc-500 uppercase flex items-center gap-2">
                <LinkIcon className="w-4 h-4" /> Video Link (FB / YouTube)
              </h2>
              <div className="glass-panel p-1 flex items-center gap-2 focus-within:border-emerald-500/50 transition-colors">
                <div className="pl-3 flex gap-2 text-zinc-500">
                  <Facebook className="w-4 h-4" />
                  <Youtube className="w-4 h-4" />
                </div>
                <input 
                  type="text" 
                  value={videoUrl}
                  onChange={(e) => {
                    setVideoUrl(e.target.value);
                    if (e.target.value) {
                      setVideoFile(null);
                      setVideoPreview(null);
                    }
                  }}
                  placeholder="https://www.facebook.com/... or https://youtube.com/..."
                  className="w-full bg-transparent py-3 px-2 text-sm text-zinc-200 focus:outline-none placeholder:text-zinc-600"
                />
              </div>
              {videoUrl && (
                <p className="text-[10px] text-zinc-500 italic">
                  Note: Analysis via link uses Google Search grounding to understand content if direct access is restricted.
                </p>
              )}
            </section>

            <div className="flex items-center gap-4 py-2">
              <div className="h-[1px] flex-grow bg-zinc-800" />
              <span className="text-[10px] font-mono text-zinc-600 uppercase">OR</span>
              <div className="h-[1px] flex-grow bg-zinc-800" />
            </div>

            <section className="space-y-4">
              <h2 className="text-sm font-mono text-zinc-500 uppercase flex items-center gap-2">
                <Video className="w-4 h-4" /> Source Reference
              </h2>
              
              <div 
                {...getRootProps()} 
                className={cn(
                  "relative aspect-video glass-panel flex flex-col items-center justify-center cursor-pointer overflow-hidden transition-all group",
                  isDragActive ? "border-emerald-500 bg-emerald-500/5" : "hover:border-zinc-600",
                  videoPreview ? "p-0" : "p-12"
                )}
              >
                <input {...getInputProps()} />
                
                {videoPreview ? (
                  <>
                    <video 
                      src={videoPreview} 
                      className="w-full h-full object-cover"
                      controls
                    />
                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="bg-black/80 backdrop-blur px-3 py-1.5 rounded-full text-[10px] font-mono text-white flex items-center gap-2">
                        <Upload className="w-3 h-3" /> CHANGE SOURCE
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                      <Upload className="w-8 h-8 text-zinc-400" />
                    </div>
                    <div>
                      <p className="text-zinc-200 font-medium">Drop reference video here</p>
                      <p className="text-zinc-500 text-sm mt-1">MP4, MOV or WebM supported</p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Analysis Mode Selector */}
            <section className="space-y-4">
              <h2 className="text-sm font-mono text-zinc-500 uppercase flex items-center gap-2">
                <Settings2 className="w-4 h-4" /> Analysis Mode
              </h2>
              <div className="grid grid-cols-3 gap-2">
                {(['normal', 'semi-timelapse', 'timelapse'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setAnalysisMode(mode)}
                    className={cn(
                      "py-3 px-2 rounded-xl border text-[10px] font-mono uppercase tracking-tighter transition-all flex flex-col items-center gap-2",
                      analysisMode === mode 
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                        : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                    )}
                  >
                    <Clock className={cn("w-4 h-4", analysisMode === mode ? "text-emerald-500" : "text-zinc-600")} />
                    {mode.replace('-', ' ')}
                  </button>
                ))}
              </div>
            </section>

            <button
              onClick={handleAnalyze}
              disabled={(!videoFile && !videoUrl) || isAnalyzing}
              className={cn(
                "w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all",
                (!videoFile && !videoUrl) || isAnalyzing 
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                  : "bg-emerald-500 text-black hover:bg-emerald-400 active:scale-[0.98]"
              )}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing Temporal Data...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate Scene Sequence
                </>
              )}
            </button>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <AnimatePresence mode="wait">
              {result ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-8"
                >
                  <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-white">{result.title}</h2>
                    <p className="text-zinc-400 text-sm leading-relaxed">{result.summary}</p>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-mono text-zinc-500 uppercase flex items-center gap-2">
                        <LayoutGrid className="w-4 h-4" /> Progression Sequence
                      </h3>
                      <div className="flex gap-2">
                         <div className="px-2 py-1 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400">
                           {result.scenes.length} KEYFRAMES
                         </div>
                      </div>
                    </div>

                    <div className="grid gap-4 relative">
                      {result.scenes.map((scene, idx) => (
                        <React.Fragment key={idx}>
                          <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className="glass-panel p-6 group hover:border-emerald-500/30 transition-colors relative z-10"
                          >
                            <div className="flex flex-col md:flex-row gap-6">
                              <div className="flex-shrink-0">
                                <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500 font-mono text-xs">
                                  {idx + 1}
                                </div>
                              </div>
                              <div className="flex-grow space-y-4">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-mono text-emerald-500 uppercase tracking-tighter bg-emerald-500/10 px-2 py-0.5 rounded">
                                    {scene.changeType}
                                  </span>
                                  <span className="text-[10px] font-mono text-zinc-500">
                                    TS: {scene.timestamp}
                                  </span>
                                </div>
                                
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <p className="text-zinc-200 text-sm font-medium">{scene.description}</p>
                                    <div className="bg-black/40 rounded-lg p-4 border border-zinc-800 group-hover:border-zinc-700 transition-colors relative">
                                      <div className="flex items-start gap-3">
                                        <ImageIcon className="w-4 h-4 text-zinc-500 mt-1 flex-shrink-0" />
                                        <p className="text-zinc-400 text-xs italic leading-relaxed pr-8">
                                          "{scene.imagePrompt}"
                                        </p>
                                      </div>
                                      <button 
                                        onClick={() => handleCopy(scene.imagePrompt, idx)}
                                        className="absolute top-4 right-4 text-zinc-500 hover:text-emerald-400 transition-colors"
                                        title="Copy Prompt"
                                      >
                                        {copiedIndex === idx ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                      </button>
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 uppercase">
                                      <Languages className="w-3 h-3" /> Terjemahan (Bisa Diedit)
                                    </div>
                                    <textarea
                                      value={scene.indonesianTranslation}
                                      onChange={(e) => handleTranslationChange(idx, e.target.value)}
                                      className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50 transition-colors resize-none min-h-[60px]"
                                      placeholder="Terjemahan bahasa Indonesia..."
                                    />
                                  </div>
                                </div>
                                
                                <div className="flex justify-end">
                                  <button 
                                    onClick={() => handleCopy(scene.imagePrompt, idx)}
                                    className="text-[10px] font-mono text-zinc-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                                  >
                                    {copiedIndex === idx ? 'COPIED!' : 'COPY PROMPT'} <ArrowRight className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </motion.div>

                          {scene.transformationPrompt && (
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="relative py-2 px-12"
                            >
                              <div className="absolute left-[3.5rem] top-0 bottom-0 w-[1px] bg-zinc-800 z-0" />
                              <div className="glass-panel bg-emerald-500/5 border-emerald-500/20 p-4 relative z-10">
                                <div className="flex items-start gap-3">
                                  <div className="mt-1">
                                    <Play className="w-3 h-3 text-emerald-500 fill-emerald-500" />
                                  </div>
                                  <div className="space-y-1 flex-grow">
                                    <span className="text-[9px] font-mono text-emerald-500 uppercase tracking-widest">Image-to-Video Transformation</span>
                                    <p className="text-[11px] text-zinc-400 italic leading-relaxed pr-8">
                                      "{scene.transformationPrompt}"
                                    </p>
                                    
                                    <div className="mt-3 space-y-2">
                                      <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-500 uppercase">
                                        <Languages className="w-2.5 h-2.5" /> Terjemahan Transformasi (Bisa Diedit)
                                      </div>
                                      <textarea
                                        value={scene.transformationIndonesianTranslation || ''}
                                        onChange={(e) => handleTransformationTranslationChange(idx, e.target.value)}
                                        className="w-full bg-black/40 border border-zinc-800 rounded p-2 text-[10px] text-zinc-400 focus:outline-none focus:border-emerald-500/30 transition-colors resize-none min-h-[50px]"
                                        placeholder="Terjemahan transformasi..."
                                      />
                                    </div>
                                  </div>
                                  <button 
                                    onClick={() => handleCopy(scene.transformationPrompt!, idx + 100)}
                                    className="text-zinc-500 hover:text-emerald-400 transition-colors"
                                    title="Copy Transformation Prompt"
                                  >
                                    {copiedIndex === idx + 100 ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full min-h-[400px] glass-panel border-dashed flex flex-col items-center justify-center text-center p-12">
                  <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6">
                    <SplitSquareVertical className="w-8 h-8 text-zinc-700" />
                  </div>
                  <h3 className="text-zinc-400 font-medium">Analysis Pending</h3>
                  <p className="text-zinc-600 text-sm mt-2 max-w-xs">
                    Upload a video and configure the clip count to generate your temporal progression analysis.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Footer Info */}
        <footer className="pt-12 border-t border-zinc-800 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] font-mono text-zinc-500 uppercase">Engine</span>
              <span className="text-xs text-zinc-300">Gemini 3 Flash</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-mono text-zinc-500 uppercase">Output</span>
              <span className="text-xs text-zinc-300">JSON Schema v2.1</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-mono text-emerald-500 uppercase">Status</span>
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Hosting Ready
              </span>
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-600">
            &copy; 2024 VIDILAPSE TEMPORAL SYSTEMS
          </div>
        </footer>
      </div>
    </div>
  );
}
