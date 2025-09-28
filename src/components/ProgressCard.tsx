"use client"

import { Card, CardHeader, CardContent } from "./ui/card"

export default function ProgressCard() {
    // Progress tracker
    const completedScenarios = 1;
    const totalScenarios = 3;
    const progressPercent = (completedScenarios / totalScenarios) * 100;

    return (
        <Card className="flex-3/10 shadow-lg border border-gray-200">
            <CardHeader>
                <h3 className="text-lg font-bold text-gray-800">Progress Tracker</h3>
            </CardHeader>
            <CardContent>
                <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                    className="h-3 rounded-full bg-blue-600"
                    style={{ width: `${progressPercent}%` }}
                />
                </div>
                <p className="mt-2 text-sm text-gray-600">
                {completedScenarios} of {totalScenarios} scenarios completed
                </p>
            </CardContent>
        </Card>
    );
}