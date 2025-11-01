#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
// Create MCP server
const server = new McpServer({
    name: "omi-youtube-voice",
    version: "0.1.0"
});
// Tool 1: Control YouTube playback
server.tool("control_youtube", {
    action: z.enum(["play", "pause", "mute", "unmute", "faster", "slower", "skip_10", "back_10"]),
}, async ({ action }) => {
    try {
        // This would inject JavaScript into the YouTube page
        // For now, return instructions for manual control
        const jsCommands = {
            play: "document.querySelector('video').play()",
            pause: "document.querySelector('video').pause()",
            mute: "document.querySelector('video').muted = true",
            unmute: "document.querySelector('video').muted = false",
            faster: "document.querySelector('video').playbackRate = Math.min(document.querySelector('video').playbackRate + 0.25, 2)",
            slower: "document.querySelector('video').playbackRate = Math.max(document.querySelector('video').playbackRate - 0.25, 0.25)",
            skip_10: "document.querySelector('video').currentTime += 10",
            back_10: "document.querySelector('video').currentTime -= 10"
        };
        const jsCommand = jsCommands[action];
        return {
            content: [
                {
                    type: "text",
                    text: `YouTube control executed: ${action}\n\nJavaScript to inject: ${jsCommand}\n\nNote: In a real implementation, this would be injected into the YouTube page via a browser extension or Puppeteer.`,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error controlling YouTube: ${error}`,
                },
            ],
            isError: true,
        };
    }
});
// Tool 2: Search YouTube videos (using yt-dlp instead of API)
server.tool("search_youtube", {
    query: z.string().describe("Search query for YouTube videos"),
    maxResults: z.number().min(1).max(5).optional().default(3),
}, async ({ query, maxResults = 3 }) => {
    try {
        // Use yt-dlp to search YouTube (no API key needed!)
        const searchResults = await searchYouTubeWithYtdlp(query, maxResults);
        if (searchResults.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No YouTube results found for "${query}". Try a different search term.`,
                    },
                ],
            };
        }
        const resultsText = searchResults.map((video, index) => `${index + 1}. ${video.title}\n   Channel: ${video.channel}\n   Duration: ${video.duration}\n   URL: ${video.url}\n`).join('\n');
        return {
            content: [
                {
                    type: "text",
                    text: `YouTube Search Results for "${query}":\n\n${resultsText}\n\nSay "play number X" to play a video.`,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error searching YouTube: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});
// Tool 3: Get video transcript and search within it
server.tool("search_transcript", {
    videoId: z.string().describe("YouTube video ID"),
    keyword: z.string().describe("Keyword to search for in transcript"),
}, async ({ videoId, keyword }) => {
    try {
        // Use yt-dlp to get transcript
        const transcript = await getTranscript(videoId);
        if (!transcript) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Could not retrieve transcript for this video. It may not have captions available.",
                    },
                ],
            };
        }
        // Simple text search in transcript
        const matches = findKeywordMatches(transcript, keyword);
        if (matches.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No matches found for "${keyword}" in the transcript.`,
                    },
                ],
            };
        }
        const resultsText = matches.slice(0, 5).map(match => `At ${match.timestamp}: "${match.text}"`).join('\n\n');
        return {
            content: [
                {
                    type: "text",
                    text: `Found ${matches.length} matches for "${keyword}" in the transcript:\n\n${resultsText}\n\nSay "jump to X seconds" to go to a specific time.`,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error searching transcript: ${error}`,
                },
            ],
            isError: true,
        };
    }
});
// Tool 4: Jump to specific time in video
server.tool("jump_to_time", {
    seconds: z.number().min(0).describe("Time in seconds to jump to"),
}, async ({ seconds }) => {
    try {
        const jsCommand = `document.querySelector('video').currentTime = ${seconds}`;
        return {
            content: [
                {
                    type: "text",
                    text: `Jumping to ${seconds} seconds.\n\nJavaScript to inject: ${jsCommand}`,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error jumping to time: ${error}`,
                },
            ],
            isError: true,
        };
    }
});
// Helper function to get transcript using yt-dlp
async function getTranscript(videoId) {
    return new Promise((resolve) => {
        const ytDlp = spawn('yt-dlp', [
            '--skip-download',
            '--write-auto-subs',
            '--sub-langs', 'en',
            '--sub-format', 'vtt',
            '--print', '%(subtitles.en.url)s',
            `https://www.youtube.com/watch?v=${videoId}`
        ]);
        let output = '';
        let errorOutput = '';
        ytDlp.stdout.on('data', (data) => {
            output += data.toString();
        });
        ytDlp.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        ytDlp.on('close', (code) => {
            if (code === 0 && output.trim()) {
                // Try to download the VTT file
                const subtitleUrl = output.trim();
                downloadVtt(subtitleUrl).then(resolve);
            }
            else {
                console.error('yt-dlp error:', errorOutput);
                resolve(null);
            }
        });
        ytDlp.on('error', (error) => {
            console.error('Failed to run yt-dlp:', error);
            resolve(null);
        });
    });
}
// Helper function to search YouTube using yt-dlp (no API key needed!)
async function searchYouTubeWithYtdlp(query, maxResults) {
    return new Promise((resolve) => {
        const ytDlp = spawn('yt-dlp', [
            `ytsearch${maxResults}:${query}`,
            '--skip-download',
            '--print', '%(title)s|||%(uploader)s|||%(duration)s|||%(webpage_url)s',
            '--no-warnings',
            '--quiet'
        ]);
        let output = '';
        let errorOutput = '';
        ytDlp.stdout.on('data', (data) => {
            output += data.toString();
        });
        ytDlp.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        ytDlp.on('close', (code) => {
            if (code === 0 && output.trim()) {
                const videos = output.trim().split('\n').map(line => {
                    const [title, channel, duration, url] = line.split('|||');
                    return { title, channel, duration, url };
                });
                resolve(videos);
            }
            else {
                console.error('yt-dlp search error:', errorOutput);
                resolve([]);
            }
        });
        ytDlp.on('error', (error) => {
            console.error('Failed to run yt-dlp search:', error);
            resolve([]);
        });
    });
}
// Helper function to download VTT content
async function downloadVtt(url) {
    return new Promise((resolve) => {
        const curl = spawn('curl', ['-s', '--max-time', '5', url]);
        let output = '';
        let errorOutput = '';
        curl.stdout.on('data', (data) => {
            output += data.toString();
        });
        curl.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        curl.on('close', (code) => {
            if (code === 0 && output.trim()) {
                resolve(output);
            }
            else {
                console.error('Failed to download VTT:', errorOutput);
                resolve(null);
            }
        });
        curl.on('error', (error) => {
            console.error('Failed to run curl:', error);
            resolve(null);
        });
    });
}
// Helper function to find keyword matches in VTT transcript
function findKeywordMatches(vttContent, keyword) {
    const matches = [];
    // Simple VTT parsing - split by timestamps
    const lines = vttContent.split('\n');
    let currentTime = '';
    for (const line of lines) {
        // Check for timestamp lines (format: 00:00:00.000 --> 00:00:00.000)
        const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/);
        if (timeMatch) {
            currentTime = timeMatch[1];
            continue;
        }
        // Check for text content
        if (line.trim() && !line.includes('-->') && !line.match(/^\d+$/) && currentTime) {
            const lowerLine = line.toLowerCase();
            const lowerKeyword = keyword.toLowerCase();
            if (lowerLine.includes(lowerKeyword)) {
                matches.push({
                    timestamp: currentTime,
                    text: line.trim()
                });
            }
        }
    }
    return matches;
}
// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('🎥 Omi YouTube Voice Agent MCP server running on stdio');
