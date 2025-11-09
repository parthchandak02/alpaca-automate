"use client"

import { Poppins } from "next/font/google";
import { SWRConfig } from "swr";
import "./globals.css";

const poppins = Poppins({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-poppins",
});

// SWR fetcher function
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error('An error occurred while fetching the data.')
    // @ts-ignore
    error.info = await res.json()
    // @ts-ignore
    error.status = res.status
    throw error
  }
  return res.json()
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${poppins.variable} font-sans antialiased`}
        style={{ fontFamily: "var(--font-poppins), Poppins, sans-serif" }}
      >
        <SWRConfig
          value={{
            fetcher,
            refreshInterval: 5000, // Poll every 5 seconds
            revalidateOnFocus: true,
            revalidateOnReconnect: true,
            dedupingInterval: 2000, // Dedupe requests within 2 seconds
            errorRetryCount: 3,
            errorRetryInterval: 5000,
          }}
        >
          {children}
        </SWRConfig>
      </body>
    </html>
  );
}
