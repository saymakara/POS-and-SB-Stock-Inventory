import React, { useState, useRef } from 'react';
import { AppSettings, ThemeMode } from '../types';
import {
  AppBrandLogo,
  PRESET_META,
  LogoPresetId,
} from './AppBrandLogo';
import { motion } from 'motion/react';
import {
  Sparkles,
  Upload,
  Link as LinkIcon,
  Download,
  RotateCcw,
  CheckCircle2,
  Smartphone,
  CreditCard,
  Volume2,
  Laptop,
  Image as ImageIcon,
  Palette,
  Eye,
} from 'lucide-react';

interface LogoPageTabProps {
  appSettings: AppSettings;
  onUpdateAppSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  triggerToast: (msg: string) => void;
  addAuditLog: (actionTitle: string, detailText: string) => void;
  theme?: ThemeMode;
}

export const LogoPageTab: React.FC<LogoPageTabProps> = ({
  appSettings,
  onUpdateAppSettings,
  triggerToast,
  addAuditLog,
  theme = 'light',
}) => {
  const isDark = theme === 'dark';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedPreset, setSelectedPreset] = useState<LogoPresetId>(
    appSettings.logoPresetId || 'merchant-store'
  );
  const [customUrl, setCustomUrl] = useState<string>(appSettings.customLogoUrl || '');
  const [titleInput, setTitleInput] = useState<string>(
    appSettings.customLogoTitle || 'POS & Sound Box Stock'
  );
  const [subtitleInput, setSubtitleInput] = useState<string>(
    appSettings.customLogoSubtitle || 'Branch Operations Portal'
  );

  const [activeMockup, setActiveMockup] = useState<'sidebar' | 'pos' | 'soundbox' | 'mobile' | 'report'>('sidebar');
  const [canvasBg, setCanvasBg] = useState<'dark' | 'light' | 'transparent' | 'teal'>('dark');

  // Handle local file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      triggerToast('Please upload a valid image file (PNG, SVG, JPG, WebP)');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      triggerToast('File size must be under 8MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setCustomUrl(result);
      triggerToast(`Loaded "${file.name}" for live preview`);
    };
    reader.readAsDataURL(file);
  };

  // Apply Changes to App
  const handleApplyBrand = () => {
    onUpdateAppSettings((prev) => ({
      ...prev,
      customLogoUrl: customUrl.trim(),
      customLogoTitle: titleInput.trim() || 'POS & Sound Box Stock',
      customLogoSubtitle: subtitleInput.trim() || 'Branch Operations Portal',
      logoPresetId: selectedPreset,
    }));

    addAuditLog(
      'Brand Identity Updated',
      `Updated portal logo preset to "${PRESET_META[selectedPreset].name}", Title: "${titleInput}"`
    );
    triggerToast('Brand identity & logo updated across all portals!');
  };

  // Reset to default
  const handleResetBrand = () => {
    setSelectedPreset('merchant-store');
    setCustomUrl('');
    setTitleInput('POS & Sound Box Stock');
    setSubtitleInput('Branch Operations Portal');

    onUpdateAppSettings((prev) => ({
      ...prev,
      customLogoUrl: '',
      customLogoTitle: 'POS & Sound Box Stock',
      customLogoSubtitle: 'Branch Operations Portal',
      logoPresetId: 'merchant-store',
    }));

    addAuditLog('Brand Identity Reset', 'Reset logo and portal titles to system defaults');
    triggerToast('Brand reset to factory default');
  };

  // Download SVG
  const handleDownloadSvg = () => {
    const svgContent = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="vms_bg" cx="50%" cy="40%" r="65%"><stop offset="0%" stop-color="#145b8e"/><stop offset="55%" stop-color="#0e4773"/><stop offset="100%" stop-color="#082c4a"/></radialGradient></defs><rect x="3" y="3" width="94" height="94" rx="22" fill="url(#vms_bg)"/><rect x="3" y="3" width="94" height="94" rx="22" stroke="rgba(255, 255, 255, 0.16)" stroke-width="1"/><rect x="7" y="7" width="86" height="86" rx="18" stroke="#1b6ca6" stroke-width="0.8"/><g><path d="M 27,37 L 73,37 L 73,65 Q 73,69 69,69 L 31,69 Q 27,69 27,65 Z" fill="#ffffff"/><rect x="32" y="47.5" width="12" height="21.5" rx="1.5" fill="#0b375b"/><circle cx="41" cy="58" r="1.2" fill="#00d9a3"/><rect x="48" y="47.5" width="10" height="12" rx="1.2" fill="#0b375b"/><rect x="59.5" y="47.5" width="10" height="12" rx="1.2" fill="#0b375b"/><path d="M 23,28 L 33.8,28 L 33.8,37 Q 28.4,42 23,37 Z" fill="#009e7e"/><path d="M 33.8,28 L 44.6,28 L 44.6,37 Q 39.2,42 33.8,37 Z" fill="#5ce2c0"/><path d="M 44.6,28 L 55.4,28 L 55.4,37 Q 50,42 44.6,37 Z" fill="#009e7e"/><path d="M 55.4,28 L 66.2,28 L 66.2,37 Q 60.8,42 55.4,37 Z" fill="#5ce2c0"/><path d="M 66.2,28 L 77,28 L 77,37 Q 71.6,42 66.2,37 Z" fill="#009e7e"/><rect x="22" y="24" width="56" height="5" rx="2.5" fill="#ffffff"/></g><g><circle cx="75" cy="68" r="15" fill="#082a47"/><circle cx="75" cy="68" r="12" fill="#14ab84"/><path d="M 69,68 L 73.5,72.5 L 81.5,63" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brand-logo-verified-merchant.svg';
    a.click();
    URL.revokeObjectURL(url);
    triggerToast(`Downloaded brand-logo-${selectedPreset}.svg`);
  };

  // Download High-Res PNG
  const handleDownloadPng = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvasBg !== 'transparent') {
      ctx.fillStyle = canvasBg === 'dark' ? '#0f172a' : canvasBg === 'teal' ? '#003844' : '#ffffff';
      ctx.fillRect(0, 0, 512, 512);
    }

    const img = new Image();
    const svgData = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="simpleBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#003844"/><stop offset="100%" stop-color="#005d6e"/></linearGradient><linearGradient id="simpleWaves" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#10b981"/><stop offset="100%" stop-color="#38bdf8"/></linearGradient></defs><rect x="2" y="2" width="44" height="44" rx="12" fill="url(#simpleBg)"/><rect x="11" y="11" width="16" height="26" rx="4.5" fill="#ffffff"/><rect x="13.5" y="14" width="11" height="8.5" rx="2" fill="#002b36"/><circle cx="16.5" cy="27" r="1.5" fill="#005d6e"/><rect x="20" y="26" width="4.5" height="2" rx="1" fill="#005d6e"/><path d="M31 18C33.2 20.2 34.5 23 34.5 26C34.5 29 33.2 31.8 31 34" stroke="url(#simpleWaves)" stroke-width="2.5" stroke-linecap="round"/><path d="M36 13.5C39.5 17 41.5 21.2 41.5 26C41.5 30.8 39.5 35 36 38.5" stroke="url(#simpleWaves)" stroke-width="2.5" stroke-linecap="round"/></svg>`;
    img.src = customUrl || 'data:image/svg+xml;base64,' + btoa(svgData);
    img.onload = () => {
      ctx.drawImage(img, 64, 64, 384, 384);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `brand-logo-${selectedPreset}-512px.png`;
      a.click();
      triggerToast('Downloaded 512x512 High-Res PNG badge');
    };
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Page Header */}
      <div
        className={`p-6 rounded-3xl border ${
          isDark
            ? 'bg-slate-900/80 border-slate-800 text-white'
            : 'bg-white/90 border-slate-200/90 text-slate-900'
        } backdrop-blur-xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6 transform-gpu`}
      >
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#004953] to-emerald-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-[#004953]/25">
            <Sparkles className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-black tracking-tight">
                Brand &amp; Logo Studio
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Live Sync 60fps
              </span>
            </div>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              Customize the official emblem, typography, and visual brand assets displayed across
              your desktop inventory dashboard, mobile sync portals, and executive PDF reports.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={handleResetBrand}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={handleApplyBrand}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#004953] to-[#006978] hover:from-[#003840] hover:to-[#005460] text-white text-xs font-extrabold flex items-center gap-2 cursor-pointer shadow-lg shadow-[#004953]/25 transition-all"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            <span>Apply Everywhere</span>
          </motion.button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Preset Gallery & Custom Upload (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. Official Preset Selection */}
          <div
            className={`p-6 rounded-3xl border ${
              isDark ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-slate-200/90'
            } shadow-lg`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-[#004953] dark:text-emerald-400" />
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                  1. Official System Brand Logo
                </h2>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                2D Flat Vector • Smooth Micro-Animations
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3.5">
              {(Object.keys(PRESET_META) as LogoPresetId[]).map((key) => {
                const meta = PRESET_META[key];
                const isSelected = selectedPreset === key && !customUrl;

                return (
                  <motion.div
                    key={key}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setSelectedPreset(key);
                      setCustomUrl('');
                    }}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-emerald-500/10 border-emerald-500/60 ring-2 ring-emerald-500/20 shadow-md'
                        : isDark
                        ? 'bg-slate-800/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800'
                        : 'bg-slate-50 border-slate-200/70 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="w-12 h-12 shrink-0">
                        <AppBrandLogo presetId={key} size="lg" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {meta.name}
                          </span>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
                            {meta.tag}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                          {meta.description}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* 2. Custom Logo Upload & Configuration */}
          <div
            className={`p-6 rounded-3xl border ${
              isDark ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-slate-200/90'
            } shadow-lg`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#004953] dark:text-emerald-400" />
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                  2. Upload Custom Organization Logo
                </h2>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                PNG / SVG / WebP
              </span>
            </div>

            <div className="space-y-4">
              {/* Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`p-6 rounded-2xl border-2 border-dashed text-center cursor-pointer transition-all ${
                  customUrl
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : isDark
                    ? 'border-slate-700 hover:border-slate-500 bg-slate-800/40 hover:bg-slate-800/70'
                    : 'border-slate-300 hover:border-[#004953] bg-slate-50 hover:bg-emerald-50/30'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Click to choose custom logo
                    </span>
                    <span className="text-xs text-slate-400"> or drag &amp; drop here</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono">
                    Transparent PNG, SVG vector, or high-res square JPG (max 8MB)
                  </p>
                </div>
              </div>

              {/* Direct URL input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <LinkIcon className="w-3.5 h-3.5 text-slate-400" />
                  <span>Or Paste External Image URL</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={customUrl.startsWith('data:') ? '' : customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://yourbank.com/assets/logo.png"
                    className={`flex-1 px-3.5 py-2 rounded-xl text-xs border focus:outline-none focus:ring-2 focus:ring-[#004953] ${
                      isDark
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                  {customUrl && (
                    <button
                      type="button"
                      onClick={() => setCustomUrl('')}
                      className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Title & Subtitle Customizer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Portal Brand Title
                  </label>
                  <input
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    placeholder="POS & Sound Box Stock"
                    className={`px-3.5 py-2 rounded-xl text-xs border focus:outline-none focus:ring-2 focus:ring-[#004953] ${
                      isDark
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Portal Subtitle / Division
                  </label>
                  <input
                    type="text"
                    value={subtitleInput}
                    onChange={(e) => setSubtitleInput(e.target.value)}
                    placeholder="Branch Operations Portal"
                    className={`px-3.5 py-2 rounded-xl text-xs border focus:outline-none focus:ring-2 focus:ring-[#004953] ${
                      isDark
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Mockup Studio & Asset Downloader (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Live Preview Canvas Card */}
          <div
            className={`p-6 rounded-3xl border ${
              isDark ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-slate-200/90'
            } shadow-lg space-y-4`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-[#004953] dark:text-emerald-400" />
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                  Live Brand Preview
                </h3>
              </div>

              {/* Background Color Toggles for Preview */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setCanvasBg('dark')}
                  className={`w-5 h-5 rounded-md bg-slate-950 border ${
                    canvasBg === 'dark' ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-transparent'
                  }`}
                  title="Dark Background"
                />
                <button
                  type="button"
                  onClick={() => setCanvasBg('teal')}
                  className={`w-5 h-5 rounded-md bg-[#004953] border ${
                    canvasBg === 'teal' ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-transparent'
                  }`}
                  title="Fintech Teal"
                />
                <button
                  type="button"
                  onClick={() => setCanvasBg('light')}
                  className={`w-5 h-5 rounded-md bg-white border ${
                    canvasBg === 'light' ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-300'
                  }`}
                  title="Light Background"
                />
              </div>
            </div>

            {/* Big Emblem Showcase */}
            <div
              className={`p-8 rounded-2xl flex flex-col items-center justify-center text-center transition-colors shadow-inner ${
                canvasBg === 'dark'
                  ? 'bg-slate-950 text-white'
                  : canvasBg === 'teal'
                  ? 'bg-[#003840] text-white'
                  : 'bg-slate-100 text-slate-900'
              }`}
            >
              <AppBrandLogo
                logoUrl={customUrl}
                presetId={selectedPreset}
                size="2xl"
                showGlow={true}
              />
              <div className="mt-4">
                <h4 className="text-base font-extrabold tracking-tight">
                  {titleInput || 'POS & Sound Box Stock'}
                </h4>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {subtitleInput || 'Branch Operations Portal'}
                </p>
              </div>
            </div>

            {/* Surface Context Mockup Selector */}
            <div className="space-y-3 pt-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[10px]">
                Surface Context Preview
              </span>

              <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setActiveMockup('sidebar')}
                  className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all ${
                    activeMockup === 'sidebar'
                      ? 'bg-white dark:bg-slate-700 text-[#004953] dark:text-emerald-300 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Laptop className="w-3.5 h-3.5" />
                  <span>Sidebar</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMockup('pos')}
                  className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all ${
                    activeMockup === 'pos'
                      ? 'bg-white dark:bg-slate-700 text-[#004953] dark:text-emerald-300 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>POS</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMockup('soundbox')}
                  className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all ${
                    activeMockup === 'soundbox'
                      ? 'bg-white dark:bg-slate-700 text-[#004953] dark:text-emerald-300 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>SoundBox</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMockup('mobile')}
                  className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all ${
                    activeMockup === 'mobile'
                      ? 'bg-white dark:bg-slate-700 text-[#004953] dark:text-emerald-300 shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Mobile</span>
                </button>
              </div>

              {/* Surface Container Mockup View */}
              <div className="p-4 rounded-2xl bg-slate-900 text-white border border-slate-800 min-h-[120px] flex items-center justify-center">
                {activeMockup === 'sidebar' && (
                  <div className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/10">
                    <AppBrandLogo logoUrl={customUrl} presetId={selectedPreset} size="md" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{titleInput}</div>
                      <div className="text-[10px] text-zinc-400 font-mono truncate">{subtitleInput}</div>
                    </div>
                  </div>
                )}

                {activeMockup === 'pos' && (
                  <div className="w-56 p-4 rounded-2xl bg-slate-950 border-2 border-slate-700 shadow-xl text-center space-y-2">
                    <div className="text-[9px] font-mono text-emerald-400">READY FOR TAP • Wizar Q2 Pro</div>
                    <div className="flex justify-center">
                      <AppBrandLogo logoUrl={customUrl} presetId={selectedPreset} size="lg" />
                    </div>
                    <div className="text-xs font-bold text-white">{titleInput}</div>
                    <div className="text-[10px] font-mono text-slate-400">Insert / Swipe / Tap Card</div>
                  </div>
                )}

                {activeMockup === 'soundbox' && (
                  <div className="w-52 p-4 rounded-3xl bg-emerald-950/80 border-2 border-emerald-500/40 text-center space-y-2">
                    <div className="w-6 h-1 rounded-full bg-emerald-400 mx-auto" />
                    <div className="flex justify-center">
                      <AppBrandLogo logoUrl={customUrl} presetId={selectedPreset} size="lg" />
                    </div>
                    <div className="text-xs font-black text-emerald-100">{titleInput}</div>
                    <div className="text-[9px] font-mono text-emerald-400">Aisino S90 • Voice Speaker Active</div>
                  </div>
                )}

                {activeMockup === 'mobile' && (
                  <div className="w-48 p-3 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-1.5">
                    <div className="w-12 h-1 rounded-full bg-slate-700 mx-auto mb-2" />
                    <div className="flex justify-center">
                      <AppBrandLogo logoUrl={customUrl} presetId={selectedPreset} size="sm" />
                    </div>
                    <div className="text-[11px] font-bold text-white truncate">{titleInput}</div>
                    <div className="text-[8px] text-slate-400 font-mono">Mobile Installer Companion v2.4</div>
                  </div>
                )}
              </div>
            </div>

            {/* Download Brand Kit */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleDownloadSvg}
                className="flex-1 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Vector SVG</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadPng}
                className="flex-1 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>512px PNG</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
