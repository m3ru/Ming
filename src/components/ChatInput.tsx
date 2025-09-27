import React, { useState, useEffect } from 'react';
import { useCedarStore } from 'cedar-os';
import { ChatInput } from '../cedar/components/chatInput'
import { SidePanelCedarChat } from '@/cedar/components/chatComponents/SidePanelCedarChat';
import { Button } from '@/components/ui/button';



const ChatDataExporter = ({ children, ...sidePanelProps }) => {
    // 1. Access the chat state from the store
    const { messages, inputValue } = useCedarStore((state) => ({
        messages: state.messages,
        inputValue: state.inputValue,
    }));
    
    const [status, setStatus] = useState('idle');

    const handleExportAndPost = async () => {
        setStatus('sending');
        console.log('Preparing to export chat data...');

        // 2. Structure the data into a JSON object
        const chatData = {
            chatLog: messages,
            currentMessage: inputValue,
            exportedAt: new Date().toISOString(),
        };

        try {
            // 3. POST the JSON data to your backend server
            const response = await fetch('/api/save-chat', { // <-- IMPORTANT: Replace with your actual API endpoint
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(chatData, null, 2),
            });

            if (!response.ok) {
                // Handle HTTP errors
                throw new Error(`Server responded with status: ${response.status}`);
            }

            const result = await response.json();
            console.log('Successfully posted chat data:', result);
            setStatus('success');
            
        } catch (error) {
            console.error('Failed to post chat data:', error);
            setStatus('error');
        } finally {
            // Reset status after a few seconds
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    return (
        <SidePanelCedarChat {...sidePanelProps}>
            <div className="relative">
                {/* 4. Add a button to trigger the export */}
                <div className="absolute top-0 right-0 p-4 z-10">
                     <Button
                    onClick={handleExportAndPost}
                    disabled={status === 'sending'}
                    variant={status === 'error' ? 'destructive' : 'default'}
                    className={cn({
                        'bg-green-500 hover:bg-green-600': status === 'success',
                        'bg-indigo-600 hover:bg-indigo-700': status === 'idle',
                    })}>
                    {status === 'sending' ? 'Exporting...' : 
                     status === 'success' ? 'Exported!' : 
                     status === 'error'   ? 'Failed!' : 
                     'Export Chat'}
                    </Button>
                </div>
               
                {/* This is where your main page content goes */}
                {children}
            </div>
        </SidePanelCedarChat>
    );
};


// --- Example App Usage ---
// This is how you would use your new ChatDataExporter component.

export default function App() {
    // Mock fetch to simulate a backend API call for this example
    useEffect(() => {
        window.fetch = async (url, options) => {
            if (url === '/api/save-chat' && options.method === 'POST') {
                console.log('Mock API received:', JSON.parse(options.body));
                 // Simulate network delay
                await new Promise(resolve => setTimeout(resolve, 1500));
                return new Response(JSON.stringify({ status: 'ok', message: 'Chat saved successfully.' }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                });
            }
            // Fallback for any other fetch calls
            return window.fetch(url, options);
        };
    }, []);

    return (
        <ChatDataExporter
            side='right'
            title='Real-Time Transcript'
            dimensions={{ width: 400 }}
        >
            {/* Your main page content goes here */}
            <div className='p-8'>
                <h1 className="text-3xl font-bold">Your Main Application</h1>
                <p className="mt-4 text-gray-600">This is the main content of your page. The chat exporter and panel will appear around it.</p>
                <p className="mt-2 text-gray-600">Click the "Export Chat" button in the top right to post the chat log to the (mock) backend.</p>
            </div>
        </ChatDataExporter>
    );
}
