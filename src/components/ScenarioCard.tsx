"use client"
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";

export default function ScenarioCard({ 
  imageUrl, 
  title, 
  description, 
  color, 
  locked = false 
}: { 
  imageUrl: string; 
  title: string; 
  description: string; 
  color: string; 
  locked?: boolean;
}) {
    return (
    <Card className={`flex-1 flex flex-col p-2 max-w-1md relative ${locked ? 'opacity-60' : ''}`} style={{ backgroundColor: color }}>
            {locked && (
                <div className="absolute top-2 right-2 z-10 bg-gray-800 bg-opacity-80 rounded-full p-2">
                    <Lock className="w-5 h-5 text-white" />
                </div>
            )}
            <CardHeader>
                <h2 className="text-xl font-semibold">
                    {locked ? (
                        <span className="cursor-not-allowed text-gray-600">{title}</span>
                    ) : (
                        <a href='/scenario' className="hover:text-blue-600 transition-colors">{title}</a>
                    )}
                </h2>
            </CardHeader>
            <CardContent className="flex-1">
                <img
                src={imageUrl}
                alt={title}
                className={`w-full h-48 object-cover rounded ${locked ? 'grayscale' : ''}`}
                loading="lazy"
                />
                {locked && (
                    <p className="text-sm text-gray-500 mt-2 text-center">
                        Complete previous scenarios to unlock
                    </p>
                )}
            </CardContent>
    </Card>
    );
}