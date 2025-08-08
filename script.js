// Helper function to convert a Base64 string to an ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// Helper function to convert signed 16-bit PCM data to a WAV Blob
function pcmToWav(pcmData, sampleRate) {
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // File size
    view.setUint32(4, 36 + pcmData.length * 2, true);
    // WAV identifier
    writeString(view, 8, 'WAVE');
    // FMT chunk identifier
    writeString(view, 12, 'fmt ');
    // FMT chunk size
    view.setUint32(16, 16, true);
    // Audio format (1 for PCM)
    view.setUint16(20, 1, true);
    // Number of channels
    view.setUint16(22, 1, true);
    // Sample rate
    view.setUint32(24, sampleRate, true);
    // Byte rate (SampleRate * Channels * BitsPerSample/8)
    view.setUint32(28, sampleRate * 1 * 2, true);
    // Block align (Channels * BitsPerSample/8)
    view.setUint16(32, 1 * 2, true);
    // Bits per sample
    view.setUint16(34, 16, true);
    // DATA chunk identifier
    writeString(view, 36, 'data');
    // Data size
    view.setUint32(40, pcmData.length * 2, true);

    const output = new Int16Array(wavHeader.byteLength / 2 + pcmData.length);
    output.set(new Int16Array(wavHeader), 0);
    output.set(pcmData, wavHeader.byteLength / 2);

    return new Blob([output], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Get references to all DOM elements
    const mainContent = document.getElementById('main-content');
    const textInput = document.getElementById('text-input');
    const charCount = document.getElementById('char-count');
    const voiceSelect = document.getElementById('voice-select');
    const generateButton = document.getElementById('generate-button');
    const loadingIndicator = document.getElementById('loading-indicator');
    const audioContainer = document.getElementById('audio-container');
    const audioPlayer = document.getElementById('audio-player');
    const downloadButton = document.getElementById('download-button');
    const thanksMessage = document.getElementById('thanks-message');
    const errorMessage = document.getElementById('error-message');

    let audioUrl = null;

    // Add initial fade-in class
    mainContent.classList.add('fade-in');

    // Update character count on input
    textInput.addEventListener('input', () => {
        charCount.textContent = `${textInput.value.length} / 80000`;
    });

    // Main function to handle voice generation
    generateButton.addEventListener('click', async () => {
        const text = textInput.value;
        const selectedVoice = voiceSelect.value;

        // Reset UI state
        errorMessage.textContent = '';
        errorMessage.classList.add('hidden');
        audioContainer.classList.add('hidden');
        thanksMessage.classList.add('hidden');
        generateButton.disabled = true;
        loadingIndicator.classList.remove('hidden');

        // Revoke the previous audio URL to free up memory
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrl = null;
        }

        if (!text) {
            errorMessage.textContent = 'Please enter some text to generate voice.';
            errorMessage.classList.remove('hidden');
            loadingIndicator.classList.add('hidden');
            generateButton.disabled = false;
            return;
        }

        try {
            const prompt = `Say: ${text}`;
            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: selectedVoice }
                        }
                    }
                },
                model: "gemini-2.5-flash-preview-tts"
            };

            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

            let response;
            let result;
            let retryCount = 0;
            const maxRetries = 5;
            let delay = 1000; // 1 second

            while (retryCount < maxRetries) {
                try {
                    response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (response.status === 429) { // Too many requests
                        retryCount++;
                        console.warn(`API call failed with status 429. Retrying in ${delay}ms...`);
                        await new Promise(res => setTimeout(res, delay));
                        delay *= 2; // Exponential backoff
                        continue;
                    }

                    result = await response.json();
                    break; // Success, break out of retry loop
                } catch (err) {
                    errorMessage.textContent = 'Failed to fetch from API. Please check your network and try again.';
                    errorMessage.classList.remove('hidden');
                    loadingIndicator.classList.add('hidden');
                    generateButton.disabled = false;
                    return;
                }
            }

            if (result.error) {
                errorMessage.textContent = `API Error: ${result.error.message}`;
                errorMessage.classList.remove('hidden');
                loadingIndicator.classList.add('hidden');
                generateButton.disabled = false;
                return;
            }

            const part = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (audioData && mimeType && mimeType.startsWith("audio/")) {
                const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
                const pcmData = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                audioUrl = URL.createObjectURL(wavBlob);
                audioPlayer.src = audioUrl;
                audioContainer.classList.remove('hidden');
                thanksMessage.classList.remove('hidden');
            } else {
                errorMessage.textContent = 'Failed to parse audio response from API.';
                errorMessage.classList.remove('hidden');
            }
        } catch (err) {
            errorMessage.textContent = 'An unexpected error occurred. Please try again.';
            errorMessage.classList.remove('hidden');
        } finally {
            loadingIndicator.classList.add('hidden');
            generateButton.disabled = false;
        }
    });

    // Handle download button click
    downloadButton.addEventListener('click', () => {
        if (audioUrl) {
            const link = document.createElement('a');
            link.href = audioUrl;
            link.download = 'azan-voice.wav';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    });
});
