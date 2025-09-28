"use client"

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, Trophy, Star } from 'lucide-react';

export default function AchievementsCard() {
      // Example achievements
    const achievements = [
        { title: 'First Scenario Complete', icon: Trophy, unlocked: true },
        { title: 'Conflict Resolver', icon: Star, unlocked: false },
        { title: 'Empathy Master', icon: Star, unlocked: false },
    ];
    return (
        <Card className="flex-3/10 shadow-lg border border-gray-200">
            <CardHeader>
                <h3 className="text-lg font-bold text-gray-800">Achievements</h3>
            </CardHeader>
            <CardContent className="flex gap-4">
                {achievements.map((ach, idx) => (
                <div
                    key={idx}
                    className={`flex flex-col items-center justify-center p-4 rounded-lg w-32 h-32 ${
                    ach.unlocked ? 'bg-blue-100' : 'bg-gray-100 opacity-50'
                    }`}
                >
                    <ach.icon
                    className={`h-8 w-8 mb-2 ${
                        ach.unlocked ? 'text-blue-600' : 'text-gray-400'
                    }`}
                    />
                    <span
                    className={`text-center text-sm ${
                        ach.unlocked ? 'font-semibold text-gray-800' : 'text-gray-400'
                    }`}
                    >
                    {ach.title}
                    </span>
                </div>
                ))}
            </CardContent>
        </Card>
    )
}