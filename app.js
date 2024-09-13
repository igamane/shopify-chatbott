app.post("/chat", (req, res) => {
    console.log('/chat received');

    // Manually collect the raw request body
    let rawBody = '';
    req.on('data', chunk => {
        rawBody += chunk.toString();
    });

    req.on('end', async () => {
        try {
            // Sanitize the rawBody by removing invalid control characters
            rawBody = rawBody.replace(/[\u0000-\u0019]+/g, ''); // Remove any invalid control characters

            // Now, try to parse the sanitized rawBody as JSON
            const parsedBody = JSON.parse(rawBody);
            let { message } = parsedBody;

            if (!message) {
                return res.status(400).json({ error: 'No message received' });
            }

            // Optionally replace more control characters in the message after parsing
            message = message.replace(/[\u0000-\u0019]+/g, '-n-');

            console.log(`Received message: ${message}`);

            // Split the message by new lines into an array of lines
            const messageLines = message.split('-n-').filter(line => line.trim() !== '');

            // Initialize an array to hold the responses
            let responses = [];

            // Loop over each line and send a separate request to OpenAI for each
            for (let line of messageLines) {
                console.log(`Processing line: ${line}`);

                // Proceed with your OpenAI logic
                const thread = await openai.beta.threads.create();
                const threadId = thread.id;

                await openai.beta.threads.messages.create(threadId, {
                    role: "user",
                    content: line,
                });

                const run = await openai.beta.threads.runs.createAndPoll(threadId, {
                    assistant_id: process.env.ASSISTANT_ID,
                });

                const messages = await openai.beta.threads.messages.list(run.thread_id);
                const response = messages.data[0].content[0].text.value;

                console.log('Assistant response: ', response);

                let messages2 = [
                    {
                        "role": "user",
                        "content": `is this user message a question/statement: ${line} - use (isValidQuestion) function to state if its a question/statement or not - examples like (give me) (explain) (provide) are also considered valid questions - only decline weird messages or greetings or irrelevant message`
                    }
                ];

                const checkValidity = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: messages2,
                    tools: tools,
                    tool_choice: { "type": "function", "function": { "name": "isValidQuestion" } },
                });

                const responseMessage = checkValidity.choices[0].message;

                const toolCalls = responseMessage.tool_calls;
                if (toolCalls) {
                    const availableFunctions = {
                        isValidQuestion: (args) => isValidQuestion(args, line, response),
                    };
                    for (const toolCall of toolCalls) {
                        const functionName = toolCall.function.name;
                        const functionToCall = availableFunctions[functionName];
                        const functionArgs = JSON.parse(toolCall.function.arguments);
                        console.log('functionArgs ', functionArgs);
                        await functionToCall(functionArgs.isValid);
                    }
                }

                // Add the response to the array
                responses.push(response);
            }

            console.log('All responses:', responses);

            // Return all the responses in an array
            res.json({ responses });

        } catch (error) {
            console.error('Error parsing or handling chat:', error.message);
            res.status(400).json({ error: 'Invalid JSON input' });
        }
    });

    // Handle request errors
    req.on('error', (err) => {
        console.error('Request error:', err.message);
        res.status(400).json({ error: 'Request error' });
    });
});
