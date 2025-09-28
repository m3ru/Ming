"use client";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";
import Link from "next/link";

export default function ScenarioCard({
  imageUrl,
  title,
  description,
  color,
  locked = false,
  role,
}: {
  imageUrl: string;
  title: string;
  description: string;
  color: string;
  locked?: boolean;
  role?: string;
}) {
  return (
    <Link href={locked ? "#" : "/scenario"} className={`w-full flex-1 ${locked ? "cursor-not-allowed" : ""}`}>
      <Card
        className={`flex-1 flex flex-col p-2 max-w-1md relative ${locked ? "opacity-60" : "hover:shadow-lg hover:scale-[1.02] transition-transform duration-200"}`}
        style={{ backgroundColor: color }}
      >
        {locked && (
          <div className="absolute top-2 right-2 z-10 bg-gray-800 bg-opacity-80 rounded-full p-2">
            <Lock className="w-5 h-5 text-white" />
          </div>
        )}
        <CardHeader>
          <h2 className="text-xl font-semibold flex items-center">
            {locked ? (
              <span className="flex items-center mx-auto cursor-not-allowed text-gray-600">{title}</span>
            ) : (
              <span
                // href="/scenario"
                className="hover:text-blue-600 transition-colors items-center mx-auto"
              >
                {title}
              </span>
            )}
          </h2>
        </CardHeader>
        <CardContent className="flex-1">
          <img
            src={imageUrl}
            alt={title}
            className={`w-full h-48 object-cover rounded ${locked ? "grayscale" : ""}`}
            loading="lazy"
          />

          {role && (
            <div className="mt-2 text-center">
              <span
                className={`text-sm font-semibold uppercase tracking-wide ${
                  role === "Level: Intern"
                    ? "text-green-600"
                    : role === "Level: Manager"
                      ? "text-blue-800"
                      : role === "LevelL CEO"
                        ? "text-black"
                        : "text-gray-600"
                }`}
              >
                {role}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
