"use client"

import React from "react";
import { Card, CardHeader, CardContent } from "./ui/card"

export default function ProgressCard() {
    // Progress tracker
    const [scenariosCompleted, setScenariosCompleted] = React.useState(0);
    
    React.useEffect(() => {
        const numScenesString = localStorage.getItem('numScenariosCompleted');
        if (!numScenesString) {
        localStorage.setItem('numScenariosCompleted', "0");
        }
        else {
        setScenariosCompleted(parseInt(numScenesString));
        }
    }, []);
    const totalScenarios = 5;
    const progressPercent = (scenariosCompleted / totalScenarios) * 100;
    console.log('Progress percent:', progressPercent);

    return (
        <Card className="w-full shadow-lg border border-gray-200">
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
                {scenariosCompleted} of {totalScenarios} scenarios completed
                </p>
            </CardContent>
        </Card>
    );
}