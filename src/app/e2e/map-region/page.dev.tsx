"use client";

import dynamic from "next/dynamic";

const MapRegionFixture = dynamic(() => import("./MapRegionFixture"), { ssr: false });
export default function MapRegionPage() {
  return <MapRegionFixture />;
}
