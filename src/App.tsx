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
  Type as TypeIcon,
  Zap,
  Key,
  Eye,
  EyeOff,
  ExternalLink,
  Download
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
  const [taskType, setTaskType] = useState<'temporal' | 'textToVideo'>('temporal');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [clipCount, setClipCount] = useState<number>(3);
  const [analysisMode, setAnalysisMode] = useState<'normal' | 'semi-timelapse' | 'timelapse'>('semi-timelapse');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [textReference, setTextReference] = useState<string>(''); // Keep for backward compatibility if needed
  const [generatedImages, setGeneratedImages] = useState<Record<number, string>>({});
  const [generatingImageIndex, setGeneratingImageIndex] = useState<number | null>(null);
  
  // Usage Tracking States
  const [usageStats, setUsageStats] = useState({
    minuteCount: 0,
    dayCount: 0,
    lastMinuteReset: Date.now(),
    lastDayReset: Date.now()
  });

  // API Key States
  const [userApiKey, setUserApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Load API Key and Usage Stats from localStorage on mount
  React.useEffect(() => {
    const savedKey = localStorage.getItem('gemini_user_api_key');
    if (savedKey) setUserApiKey(savedKey);

    const savedStats = localStorage.getItem('gemini_usage_stats');
    if (savedStats) {
      const parsed = JSON.parse(savedStats);
      const now = Date.now();
      
      // Reset minute count if more than 60s passed
      if (now - parsed.lastMinuteReset > 60000) {
        parsed.minuteCount = 0;
        parsed.lastMinuteReset = now;
      }
      
      // Reset day count if more than 24h passed
      if (now - parsed.lastDayReset > 86400000) {
        parsed.dayCount = 0;
        parsed.lastDayReset = now;
      }
      
      setUsageStats(parsed);
    }
  }, []);

  // Update usage stats in localStorage
  React.useEffect(() => {
    localStorage.setItem('gemini_usage_stats', JSON.stringify(usageStats));
  }, [usageStats]);

  // Save API Key to localStorage when it changes
  const handleApiKeyChange = (val: string) => {
    setUserApiKey(val);
    localStorage.setItem('gemini_user_api_key', val);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      if (file.size > 15 * 1024 * 1024) {
        setError("Ukuran file terlalu besar (Maksimal 15MB untuk HP). Silakan gunakan video yang lebih pendek atau gunakan fitur 'Link Video' di atas.");
        return;
      }
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
      setError("Silakan unggah video atau masukkan link terlebih dahulu.");
      return;
    }

    const apiKey = (userApiKey || import.meta.env.VITE_GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      setError("API Key belum diisi. Silakan masukkan API Key Gemini Anda di kolom pengaturan di atas.");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress(5);
    setAnalysisStage('Mempersiapkan mesin analisis...');
    setError(null);

    // Update Usage Stats
    setUsageStats(prev => {
      const now = Date.now();
      const isNewMinute = now - prev.lastMinuteReset > 60000;
      const isNewDay = now - prev.lastDayReset > 86400000;
      
      return {
        minuteCount: isNewMinute ? 1 : prev.minuteCount + 1,
        dayCount: isNewDay ? 1 : prev.dayCount + 1,
        lastMinuteReset: isNewMinute ? now : prev.lastMinuteReset,
        lastDayReset: isNewDay ? now : prev.lastDayReset
      };
    });

    const modeInstructions: Record<string, string> = {
      timelapse: "Focus on identifying key stages of a long-term process or construction.",
      evolution: "Focus on the visual change from an initial state to a final result.",
      storyboard: "Focus on key narrative beats and cinematic transitions."
    };

    let progressInterval: any;

    try {
      setAnalysisProgress(15);
      setAnalysisStage('Menginisialisasi koneksi AI...');
      const ai = new GoogleGenAI({ apiKey });
      
      const contents: any[] = [];

      if (videoFile) {
        setAnalysisStage('Mengonversi video ke format AI (Base64)...');
        setAnalysisProgress(25);
        if (videoFile.size > 15 * 1024 * 1024) {
          throw new Error("File melebihi batas 15MB. Gunakan link video untuk file besar.");
        }
        const base64Video = await fileToBase64(videoFile);
        contents.push({
          inlineData: {
            mimeType: videoFile.type || "video/mp4",
            data: base64Video
          }
        });
        setAnalysisProgress(45);
      } else {
        setAnalysisProgress(40);
      }

      if (taskType === 'temporal') {
        setAnalysisStage('Menganalisis progresi temporal...');
        contents.push({
          text: `Analyze this video ${videoUrl ? `from this link: ${videoUrl}` : ''} and identify exactly ${clipCount} key scenes that represent a progression, timelapse, or before/after transformation. 
          
          ANALYSIS MODE: ${analysisMode.toUpperCase()}
          Instruction for this mode: ${modeInstructions[analysisMode]}
  
          For each scene, provide a JSON object with these keys:
          - "timestamp": A timestamp (approximate).
          - "description": A brief description of what changed.
          - "imagePrompt": A highly detailed text-to-image prompt that would recreate this specific scene visually.
          - "changeType": The type of change (e.g., "Initial State", "Transformation", "Final Result").
          - "indonesianTranslation": A natural Indonesian translation of the imagePrompt.
          - "transformationPrompt": (For all except last scene) A VERY CONCISE image-to-video transformation prompt (max 20 words) describing the action between this scene and the next.
          - "transformationIndonesianTranslation": A natural Indonesian translation of the transformationPrompt.
          
          PENTING: Berikan 'title' dan 'summary' dalam Bahasa Indonesia.
          
          Return the result in JSON format with a root object containing "title", "summary", and "scenes" (an array of these objects).`
        });
      } else {
        // TEXT TO VIDEO MODE (based on video reference)
        setAnalysisStage('Merancang storyboard video (T2V)...');
        setAnalysisProgress(30);
        contents.push({
          text: `Analyze this video ${videoUrl ? `from this link: ${videoUrl}` : ''} and create a professional ${clipCount}-scene text-to-video storyboard.
          
          The storyboard should capture the essence of the video but be optimized for high-end AI video generation tools (Runway Gen-3, Luma, Pika).
          
          For each scene, provide a JSON object with these keys:
          - "timestamp": A scene number or timestamp (e.g., "Scene 1" or "00:05").
          - "description": A brief description of the cinematic action.
          - "imagePrompt": A highly detailed text-to-video prompt (optimized for tools like Runway/Luma) describing visual style, lighting, camera movement, and subject action. 
            PENTING: Gabungkan instruksi transisi atau pergerakan kamera menuju adegan berikutnya langsung ke dalam "imagePrompt" ini sehingga menjadi satu prompt utuh yang mencakup aksi adegan dan transisi ke klip selanjutnya.
          - "changeType": The type of scene (e.g., "Opening", "Climax", "Resolution").
          - "indonesianTranslation": A natural Indonesian translation of the imagePrompt.
          
          JANGAN sertakan "transformationPrompt" terpisah untuk mode ini, karena transisi harus sudah menyatu di dalam "imagePrompt".
          
          PENTING: Berikan 'title' dan 'summary' dalam Bahasa Indonesia.
          
          Return the result in JSON format with a root object containing "title", "summary", and "scenes" (an array of these objects).`
        });
      }
      
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

      if (!response.text) {
        throw new Error("AI tidak memberikan respon. Coba gunakan video lain atau durasi yang lebih pendek.");
      }

      clearInterval(progressInterval);
      setAnalysisProgress(95);
      setAnalysisStage('Memvalidasi hasil...');

      const parsedResult = JSON.parse(response.text) as AnalysisResult;
      setResult(parsedResult);
      setAnalysisProgress(100);
      setAnalysisStage('Selesai!');
    } catch (err: any) {
      clearInterval(progressInterval);
      console.error(err);
      const errorMessage = err?.message || "";
      
      if (errorMessage.includes("API_KEY_INVALID") || 
          errorMessage.includes("403") || 
          errorMessage.includes("401") || 
          errorMessage.includes("unauthenticated") ||
          errorMessage.includes("API key not found")) {
        setError("⚠️ API Key Anda tidak valid atau sudah kedaluwarsa. Pastikan Anda menggunakan API Key dari Google AI Studio (Gemini).");
      } else if (errorMessage.includes("SAFETY")) {
        setError("⚠️ Video ditolak oleh sistem keamanan AI. Pastikan video tidak mengandung konten sensitif.");
      } else if (errorMessage.includes("quota") || errorMessage.includes("429")) {
        setError("⚠️ Batas penggunaan API tercapai (Rate Limit). Hal ini sering terjadi pada API Key gratis. Silakan tunggu 1-2 menit atau gunakan API Key lain.");
      } else if (errorMessage.includes("File melebihi batas 15MB")) {
        setError(errorMessage);
      } else {
        setError("Terjadi kesalahan teknis. Tips: Coba gunakan video yang lebih pendek (10-20 detik) atau gunakan fitur 'Link Video' untuk stabilitas lebih baik.");
      }
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

  const generateImage = async (prompt: string, index: number) => {
    const apiKey = (userApiKey || import.meta.env.VITE_GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      setError("API Key belum diisi. Silakan masukkan API Key Gemini Anda di kolom pengaturan.");
      return;
    }

    setGeneratingImageIndex(index);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ parts: [{ text: prompt }] }],
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          setGeneratedImages(prev => ({ ...prev, [index]: imageUrl }));
          break;
        }
      }
    } catch (err: any) {
      console.error(err);
      setError("Gagal membuat gambar. Pastikan API Key Anda mendukung model gemini-2.5-flash-image.");
    } finally {
      setGeneratingImageIndex(null);
    }
  };

  const handleDownload = () => {
    if (!result) return;

    let text = `HASIL ANALISIS PROGRESI TEMPORAL - VIDILAPSE\n`;
    text += `==============================================\n\n`;
    text += `Judul: ${result.title}\n`;
    text += `Ringkasan: ${result.summary}\n\n`;
    text += `URUTAN ADEGAN:\n`;
    text += `----------------\n\n`;

    result.scenes.forEach((scene, idx) => {
      text += `ADEGAN ${idx + 1} [Timestamp: ${scene.timestamp}]\n`;
      text += `Tipe Perubahan: ${scene.changeType}\n`;
      text += `Deskripsi: ${scene.description}\n\n`;
      text += `[IMAGE PROMPT]\n`;
      text += `English: ${scene.imagePrompt}\n`;
      text += `Indonesia: ${scene.indonesianTranslation}\n\n`;

      if (scene.transformationPrompt) {
        text += `[TRANSISI KE ADEGAN BERIKUTNYA]\n`;
        text += `English: ${scene.transformationPrompt}\n`;
        text += `Indonesia: ${scene.transformationIndonesianTranslation || 'N/A'}\n\n`;
      }
      text += `----------------------------------------------\n\n`;
    });

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.title.replace(/\s+/g, '_')}_Prompts.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
              
              {/* Quota Tracker Display */}
              <div className="pt-2 mt-2 border-t border-zinc-800/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase">Estimasi Sisa Kuota (RPM)</span>
                  <span className="text-[9px] font-mono text-emerald-500">{Math.max(0, 15 - usageStats.minuteCount)} / 15</span>
                </div>
                <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-emerald-500"
                    initial={{ width: "100%" }}
                    animate={{ width: `${Math.max(0, (15 - usageStats.minuteCount) / 15 * 100)}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[8px] font-mono text-zinc-600 uppercase">Harian (RPD)</span>
                  <span className="text-[8px] font-mono text-zinc-500">{Math.max(0, 1500 - usageStats.dayCount)} / 1500</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Controls */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* 1. Video Reference (Top) */}
            <div className="glass-panel p-6 space-y-6">
              <h2 className="text-xs font-mono text-zinc-500 uppercase flex items-center gap-2">
                <Video className="w-4 h-4" /> 1. Referensi Video
              </h2>

              <section className="space-y-4">
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
                    placeholder="Link Video (YouTube/FB)..."
                    className="w-full bg-transparent py-3 px-2 text-sm text-zinc-200 focus:outline-none placeholder:text-zinc-600"
                  />
                </div>

                <div className="flex items-center gap-4 py-2">
                  <div className="h-[1px] flex-grow bg-zinc-800" />
                  <span className="text-[10px] font-mono text-zinc-600 uppercase">ATAU UNGGAH</span>
                  <div className="h-[1px] flex-grow bg-zinc-800" />
                </div>

                <div 
                  {...getRootProps()} 
                  className={cn(
                    "relative aspect-video glass-panel flex flex-col items-center justify-center cursor-pointer overflow-hidden transition-all group",
                    isDragActive ? "border-emerald-500 bg-emerald-500/5" : "hover:border-zinc-600",
                    videoPreview ? "p-0" : "p-8"
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
                      <div className="absolute top-4 left-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/80 backdrop-blur px-3 py-1.5 rounded-full text-[10px] font-mono text-white flex items-center gap-2">
                          <Upload className="w-3 h-3" /> GANTI VIDEO
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center space-y-3">
                      <Upload className="w-6 h-6 text-zinc-500 mx-auto group-hover:scale-110 transition-transform" />
                      <div>
                        <p className="text-zinc-300 text-xs font-medium">Letakkan video di sini</p>
                        <p className="text-zinc-600 text-[10px] mt-1">MP4, MOV, WebM (Maks 15MB)</p>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* 2. Task Selection */}
            <div className="glass-panel p-6 space-y-4">
              <h2 className="text-xs font-mono text-zinc-500 uppercase flex items-center gap-2">
                <Zap className="w-4 h-4" /> 2. Pilih Jenis Tugas
              </h2>
              <div className="grid grid-cols-1 gap-2">
                <button 
                  onClick={() => setTaskType('temporal')}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border transition-all text-left",
                    taskType === 'temporal' 
                      ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                      : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                  )}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    taskType === 'temporal' ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-500"
                  )}>
                    <SplitSquareVertical className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase">Temporal Analysis Engine</div>
                    <div className="text-[10px] opacity-60 mt-0.5">Analisis progresi & transisi adegan</div>
                  </div>
                </button>

                <button 
                  onClick={() => setTaskType('textToVideo')}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border transition-all text-left",
                    taskType === 'textToVideo' 
                      ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                      : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                  )}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    taskType === 'textToVideo' ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-500"
                  )}>
                    <Play className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase">Text to Video Storyboard</div>
                    <div className="text-[10px] opacity-60 mt-0.5">Rancang storyboard cinematic T2V</div>
                  </div>
                </button>
              </div>
            </div>

            {/* 3. Analysis Settings */}
            <div className="glass-panel p-6 space-y-6">
              <h2 className="text-xs font-mono text-zinc-500 uppercase flex items-center gap-2">
                <Settings2 className="w-4 h-4" /> 3. Konfigurasi & Jalankan
              </h2>

              {taskType === 'temporal' && (
                <div className="space-y-3">
                  <label className="text-[10px] font-mono text-zinc-600 uppercase">Mode Analisis</label>
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
                </div>
              )}

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono text-zinc-600 uppercase">Jumlah Adegan (Scene)</label>
                  <span className="text-xs font-mono text-emerald-500">{clipCount}</span>
                </div>
                <input 
                  type="range" 
                  min="2" 
                  max="10" 
                  value={clipCount}
                  onChange={(e) => setClipCount(parseInt(e.target.value))}
                  className="w-full accent-emerald-500 bg-zinc-800 h-1 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {isAnalyzing && (
                <div className="space-y-4 p-4 glass-panel border-emerald-500/20 bg-emerald-500/5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                      <span className="text-xs font-medium text-emerald-400 animate-pulse">
                        {analysisStage}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-500">{analysisProgress}%</span>
                  </div>
                  <div className="w-full bg-zinc-800/50 rounded-full h-1.5 overflow-hidden">
                    <motion.div 
                      className="bg-emerald-500 h-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${analysisProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className={cn(
                  "w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all",
                  (!videoFile && !videoUrl) || isAnalyzing 
                    ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                    : "bg-emerald-500 text-black hover:bg-emerald-400 active:scale-[0.98] shadow-lg shadow-emerald-500/20"
                )}
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Memproses...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" /> {taskType === 'temporal' ? 'Jalankan Temporal Analysis' : 'Jalankan T2V Storyboard'}
                  </>
                )}
              </button>
            </div>

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
                        <LayoutGrid className="w-4 h-4" /> Urutan Progresi
                      </h3>
                      <div className="flex gap-2">
                         <button 
                           onClick={handleDownload}
                           className="flex items-center gap-2 px-3 py-1 rounded bg-emerald-500/10 text-[10px] font-mono text-emerald-500 hover:bg-emerald-500/20 transition-colors border border-emerald-500/20"
                         >
                           <Download className="w-3 h-3" /> DOWNLOAD (.TXT)
                         </button>
                         <div className="px-2 py-1 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400 flex items-center">
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
                                
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                      <div className="space-y-2">
                                        <p className="text-zinc-200 text-sm font-medium leading-snug">{scene.description}</p>
                                        <div className="bg-black/40 rounded-lg p-3 border border-zinc-800 group-hover:border-zinc-700 transition-colors relative">
                                          <div className="flex items-start gap-3">
                                            <ImageIcon className="w-4 h-4 text-zinc-500 mt-0.5 flex-shrink-0" />
                                            <p className="text-zinc-400 text-[11px] italic leading-relaxed pr-8">
                                              "{scene.imagePrompt}"
                                            </p>
                                          </div>
                                          <button 
                                            onClick={() => handleCopy(scene.imagePrompt, idx)}
                                            className="absolute top-3 right-3 text-zinc-500 hover:text-emerald-400 transition-colors"
                                            title="Copy Prompt"
                                          >
                                            {copiedIndex === idx ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                          </button>
                                        </div>
                                      </div>

                                      <div className="space-y-1.5">
                                        <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-500 uppercase">
                                          <Languages className="w-2.5 h-2.5" /> Terjemahan
                                        </div>
                                        <textarea
                                          value={scene.indonesianTranslation}
                                          onChange={(e) => handleTranslationChange(idx, e.target.value)}
                                          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg p-2.5 text-[11px] text-zinc-300 focus:outline-none focus:border-emerald-500/50 transition-colors resize-none min-h-[50px]"
                                          placeholder="Terjemahan bahasa Indonesia..."
                                        />
                                      </div>
                                    </div>

                                    <div className="space-y-4">
                                      <div className="aspect-video glass-panel overflow-hidden relative group/img">
                                        {generatedImages[idx] ? (
                                          <img 
                                            src={generatedImages[idx]} 
                                            alt={`Generated for scene ${idx + 1}`}
                                            className="w-full h-full object-cover"
                                            referrerPolicy="no-referrer"
                                          />
                                        ) : (
                                          <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900/50 text-zinc-600">
                                            {generatingImageIndex === idx ? (
                                              <div className="flex flex-col items-center gap-2">
                                                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                                                <span className="text-[10px] font-mono uppercase animate-pulse">Generating...</span>
                                              </div>
                                            ) : (
                                              <>
                                                <ImageIcon className="w-8 h-8 mb-2 opacity-20" />
                                                <span className="text-[10px] font-mono uppercase">No Image Generated</span>
                                              </>
                                            )}
                                          </div>
                                        )}
                                        
                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                                          <button
                                            onClick={() => generateImage(scene.imagePrompt, idx)}
                                            disabled={generatingImageIndex !== null}
                                            className="bg-emerald-500 text-black px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            {generatingImageIndex === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                            {generatedImages[idx] ? 'REGENERATE IMAGE' : 'GENERATE IMAGE'}
                                          </button>
                                        </div>
                                      </div>
                                      <p className="text-[9px] text-zinc-500 text-center italic">
                                        *Gambar dibuat menggunakan Gemini Flash Image (Gratis/Terintegrasi)
                                      </p>
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
                                    <span className="text-[9px] font-mono text-emerald-500 uppercase tracking-widest">Transition Prompt</span>
                                    <p className="text-[10px] text-zinc-400 italic leading-snug pr-8">
                                      "{scene.transformationPrompt}"
                                    </p>
                                    
                                    <div className="mt-2">
                                      <textarea
                                        value={scene.transformationIndonesianTranslation || ''}
                                        onChange={(e) => handleTransformationTranslationChange(idx, e.target.value)}
                                        className="w-full bg-black/40 border border-zinc-800 rounded p-2 text-[10px] text-zinc-500 focus:outline-none focus:border-emerald-500/30 transition-colors resize-none min-h-[40px]"
                                        placeholder="Terjemahan transisi..."
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
                  <h3 className="text-zinc-400 font-medium">Menunggu Analisis</h3>
                  <p className="text-zinc-600 text-sm mt-2 max-w-xs">
                    Unggah video dan atur jumlah klip untuk menghasilkan analisis progresi temporal Anda.
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
