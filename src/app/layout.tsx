import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recoverly",
  description: "Explainable failed-payment recovery, with analysis code written and run in a CreateOS Sandbox.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
