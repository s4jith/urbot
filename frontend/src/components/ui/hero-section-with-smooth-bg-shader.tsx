"use client";

import { MeshGradient } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";
import { HeroSectionProps } from "@/types";

export function HeroSection({
  title = "Intelligent AI Agents for",
  highlightText = "Smart Brands",
  description = "Transform your brand and evolve it through AI-driven brand guidelines and always up-to-date core components.",
  buttonText = "Join Waitlist",
  onButtonClick,
  colors = ["#174D38", "#4D1717", "#CBCBCB", "#F2F2F2", "#174D38", "#CBCBCB"],
  distortion = 0.8,
  swirl = 0.6,
  speed = 0.42,
  offsetX = 0.08,
  className = "",
  titleClassName = "",
  descriptionClassName = "",
  buttonClassName = "",
  maxWidth = "max-w-6xl",
  veilOpacity = "bg-white/20 dark:bg-black/25",
  fontFamily = "var(--font-sans)",
  fontWeight = 500,
}: HeroSectionProps) {
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const update = () =>
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const handleButtonClick = () => {
    if (onButtonClick) {
      onButtonClick();
    }
  };

  return (
    <section className={`relative w-full min-h-screen overflow-hidden bg-background flex items-center justify-center ${className}`}>
      <div className="fixed inset-0 w-screen h-screen">
        {mounted && (
          <>
            <MeshGradient
              width={dimensions.width}
              height={dimensions.height}
              colors={colors}
              distortion={distortion}
              swirl={swirl}
              grainMixer={0}
              grainOverlay={0}
              speed={speed}
              offsetX={offsetX}
            />
            <div className={`absolute inset-0 pointer-events-none ${veilOpacity}`} />
          </>
        )}
      </div>
      
      <div className={`relative z-10 ${maxWidth} mx-auto px-6 w-full text-center`}>
        <h1
          className={`font-bold text-foreground text-balance text-4xl sm:text-5xl md:text-6xl xl:text-[80px] leading-tight sm:leading-tight md:leading-tight lg:leading-tight xl:leading-[1.1] mb-6 lg:text-7xl ${titleClassName}`}
          style={{ fontFamily, fontWeight }}
        >
          {title} <span className="text-primary">{highlightText}</span>
        </h1>
        <p className={`text-lg sm:text-xl text-foreground/80 text-pretty max-w-2xl mx-auto leading-relaxed mb-10 px-4 ${descriptionClassName}`}>
          {description}
        </p>
        <div className="flex justify-center">
          <button
            onClick={handleButtonClick}
            className={`px-8 py-4 sm:px-10 sm:py-5 rounded-full border-2 border-primary/20 bg-primary text-white hover:bg-primary/90 transition-all font-semibold shadow-2xl hover:scale-105 active:scale-95 ${buttonClassName}`}
          >
            {buttonText}
          </button>
        </div>
      </div>
    </section>
  );
}
