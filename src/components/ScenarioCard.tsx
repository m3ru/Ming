"use client"
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export default function ScenarioCard({ imageUrl, title, description }: { imageUrl: string; title: string; description: string }) {
    return (
    <Card className="flex-1 flex flex-col p-2 max-w-1md">
            <CardHeader>
                <h2 className="text-xl font-semibold"><a href='/scenario'>{title}</a></h2>
            </CardHeader>
            <CardContent className="flex-1">
                <img
                src={imageUrl}
                alt={title}
                className="w-full h-48 object-cover rounded"
                loading="lazy"
                />
            </CardContent>
    </Card>
    );
}