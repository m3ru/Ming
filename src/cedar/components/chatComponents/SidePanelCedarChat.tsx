import React from 'react';
import { X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useCedarStore } from 'cedar-os';
import { SidePanelContainer } from '@/cedar/components/structural/SidePanelContainer';
import { CollapsedButton } from '@/cedar/components/chatMessages/structural/CollapsedChatButton';
import { ChatInput } from '@/cedar/components/chatInput/ChatInput';
import ChatBubbles from '@/cedar/components/chatMessages/ChatBubbles';
import Container3D from '@/cedar/components/containers/Container3D';
import { useThreadMessages } from 'cedar-os';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/shadcn-io/spinner';

interface SidePanelCedarChatProps {
	children?: React.ReactNode; // Page content to wrap
	side?: 'left' | 'right';
	title?: string;
	collapsedLabel?: string;
	showCollapsedButton?: boolean; // Control whether to show the collapsed button
	companyLogo?: React.ReactNode;
	dimensions?: {
		width?: number;
		minWidth?: number;
		maxWidth?: number;
	};
	resizable?: boolean;
	className?: string; // Additional CSS classes for positioning
	topOffset?: number; // Top offset in pixels (e.g., for navbar height)
	stream?: boolean; // Whether to use streaming for responses
}

export const SidePanelCedarChat: React.FC<SidePanelCedarChatProps> = ({
	children, // Page content
	side = 'right',
	title = 'Cedar Chat',
	collapsedLabel = 'How can I help you today?',
	showCollapsedButton = true,
	companyLogo,
		dimensions = {
			width: 350,
			minWidth: 300,
			maxWidth: 320,
		},
	resizable = true,
	className = '',
	topOffset = 0,
	stream = true,
}) => {
	// Get showChat state and setShowChat from store
	const showChat = useCedarStore((state) => state.showChat);
	const setShowChat = useCedarStore((state) => state.setShowChat);
	const router = useRouter();
const currentThreadId = useCedarStore((state) => state.getCurrentThreadId);
const { messages } = useThreadMessages();

// Generate transcript string in the format: user: .../bill: ...
const transcript = messages
  .map((m) => {
    if (m.role === 'user') return `user: ${m.content}`;
    if (m.role === 'assistant' || m.role === 'bot') return `bill: ${m.content}`;
    return null;
  })
  .filter(Boolean)
  .join('\n');

// Persistent resourceId per session (like SimpleChatPanel)
const [resourceId] = useState(() => {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('cedar_resourceId');
  if (!id) {
    id = Array.from({ length: 20 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    localStorage.setItem('cedar_resourceId', id);
  }
  return id;
});

const [showSpinner, setShowSpinner] = useState(false);
const [hideCompletely, setHideCompletely] = useState(false);

const handleStop = async () => {
	setShowSpinner(true);
	setShowChat(false); // Hide the chat panel so spinner is fully visible
	setHideCompletely(true); // Hide the collapsed button as well
	try {
		const response = await fetch('http://localhost:4111/api/agents/transcriptSummaryAnalyzerAgent/generate/vnext', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				messages: [
					{
						role: 'user',
						content: transcript,
					},
				],
				memory: {
					thread: currentThreadId,
					resource: resourceId,
				},
			}),
		});
		const data = await response.json();
		localStorage.setItem('reportData', JSON.stringify(data));
		router.push('/report');
	} catch (e) {
		console.error('Failed to send transcript to analyzer:', e);
	} finally {
		setShowSpinner(false);
	}
};

	return (
		<>	
			{showSpinner && (
				<div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80">
					<Spinner size={48} />
					<div className="mt-4 text-lg font-medium text-gray-700">Generating report...</div>
				</div>
			)}
					{showCollapsedButton && !hideCompletely && (
						<AnimatePresence mode='wait'>
							{!showChat && (
								<CollapsedButton
									side={side}
									label={collapsedLabel}
									onClick={() => setShowChat(true)}
									layoutId='cedar-sidepanel-chat'
									position='fixed'
								/>
							)}
						</AnimatePresence>
					)}

			<SidePanelContainer
				isActive={showChat}
				side={side}
				dimensions={dimensions}
				resizable={resizable}
				topOffset={topOffset}
				panelClassName={`dark:bg-gray-900 ${className}`}
				panelContent={
					<Container3D className='flex flex-col h-full'>
						{/* Header */}
						<div className='flex-shrink-0 z-20 flex flex-row items-center justify-between px-4 py-2 min-w-0 border-b border-gray-200 dark:border-gray-700'>
							<div className='flex items-center min-w-0 flex-1'>
								{companyLogo && (
									<div className='flex-shrink-0 w-6 h-6 mr-2'>
										{companyLogo}
									</div>
								)}
								<span className='font-bold text-lg truncate'>{title}</span>
							</div>
							<div className='flex items-center gap-2 flex-shrink-0'>
								<Button variant="destructive" onClick={handleStop} className="mr-2">Stop</Button>
								<button
									className='p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors'
									onClick={() => setShowChat(false)}
									aria-label='Close chat'>
									<X className='h-4 w-4' strokeWidth={2.5} />
								</button>
							</div>
						</div>

						{/* Chat messages - takes up remaining space */}
						<div className='flex-1 min-h-0 overflow-hidden'>
							<ChatBubbles />
						</div>

						{/* Chat input - fixed at bottom */}
						<div className='flex-shrink-0 p-3'>
							<ChatInput
								handleFocus={() => {}}
								handleBlur={() => {}}
								isInputFocused={false}
								stream={stream}
							/>
						</div>
					</Container3D>
				}>
				{/* Page content that gets squished when panel opens */}
				{children}
			</SidePanelContainer>
		</>
	);
};
