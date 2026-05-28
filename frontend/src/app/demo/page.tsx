"use client";

import { HeroSection } from "@/components/ui/hero-section-with-smooth-bg-shader";
import { useRouter } from "next/navigation";

export default function DemoPage() {
  const router = useRouter();

  return (
    <main>
      <HeroSection 
        title="Elevate Your Career with"
        highlightText="AI Interview Mastery"
        description="Master your interview skills with our intelligent, real-time feedback system. Practice anytime, anywhere."
        buttonText="Start Practice"
        onButtonClick={() => router.push("/practice")}
        distortion={1.2}
        speed={0.8}
      />
    </main>
  );
}
