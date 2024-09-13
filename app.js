require("dotenv").config(); // Load environment variables from .env file
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

const SHOP_URL = process.env.SHOP_URL;
const BLOG_ID = process.env.BLOG_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());

app.get("/", async (req, res) => {
    res.send('working...');
});

app.get("/start", async (req, res) => {
    try {
        console.log('/start received');
        const thread = await openai.beta.threads.create();
        console.log('thread returned');
        res.json({ thread_id: thread.id });
    } catch (error) {
        console.error("Error creating thread:", error);
        res.status(500).json({ error: "Failed to create thread" });
    }
});

const tools = [
    {
        "type": "function",
        "function": {
            "name": "isValidQuestion",
            "description": "Use this function to determine if the user's message is a question/statement. If the message is a question/statement, return 'true' - examples like (give me) (explain) (provide) are also considered valid questions; if it is a greeting, or irrelevant message, return 'false'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "isValid": {
                        "type": "string",
                        "enum": ["true", "false"],
                        "description": "'true' if the message is a question/statement; otherwise 'false' if its a greeting or irrelevant message (all lowercase)."
                    }
                },
                "required": [
                    "isValid"
                ]
            }
        }
    }
];
function wrapParagraphs(text) {
    // Wrap paragraphs within <p> tags, using a single new line as the separator
    return text
        .split(/\n+/) // Split text into paragraphs (single new line as separator)
        .map(paragraph => `<p>${paragraph.trim()}</p>`)
        .join(''); // Rejoin paragraphs with no extra spacing
}

function convertNewLinesAndBold(text) {
    // Wrap text in <p> tags first
    text = wrapParagraphs(text);

    // Replace **text** with <strong>text</strong> for bold
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Remove citation patterns like 【number†source】
    const pattern = /【\d+(?::\d+)?†source】/g;
    text = text.replace(pattern, '');

    // Convert Markdown headers (###, ##, #) to bold
    text = text.replace(/(#+)\s*(.*?)(<\/p>|$)/g, (match, hashes, content) => {
        const level = hashes.length; // Determine the header level
        return `<strong>${content.trim()}</strong></p>`;
    });

    // Convert Markdown links to HTML links that open in a new window
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s]+?)\)/g, '<a href="$2" target="_blank">$1</a>');

    return text;
}


// Function to create the article on Shopify
async function createArticleOnShopify(title, content) {
    const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: `Improve and optimize the user's question to create a concise and SEO-friendly blog post title. Keep the title as a question. keep it in the same language. If the question is too long for the meta title, shorten on a MAXIMUM OF 50 characters it while retaining key information. Return only the adjusted title without quotes, as your response will be used directly as the blog post title. Here is the user question: ${title}` }],
        model: "gpt-4o",
    });

    console.log('adjustedTitle', completion.choices[0].message.content);
    let adjustedTitle = completion.choices[0].message.content;
    const meta = await openai.chat.completions.create({
        messages: [{ role: "user", content: `generate a short meta description - no more than 250 character - of a blog article about this content: ${content}` }],
        model: "gpt-4o",
    });

    console.log('metaDescription', meta.choices[0].message.content);
    let metaDescription = meta.choices[0].message.content;
    // Convert new lines in content to <br> for HTML
    const htmlContent = convertNewLinesAndBold(content);
    const htmlmetaDescription = convertNewLinesAndBold(metaDescription);
    // Article data
    const articleData = {
        article: {
            blog_id: BLOG_ID,
            title: `${adjustedTitle} - De Afspraakplanners`,
            author: 'Mitchel Blok',
            body_html: htmlContent,
            summary_html: htmlmetaDescription,
            published_at: new Date().toISOString(),
            metafields: [
                {
                    key: 'description_tag',
                    value: metaDescription,  // Use the same meta description generated earlier
                    type: 'single_line_text_field',  // Define the metafield type
                    namespace: 'global',
                }
            ]
        },
    };

    // API endpoint for creating an article
    const apiVersion = '2023-10';
    const createArticleUrl = `${SHOP_URL}/admin/api/${apiVersion}/blogs/${BLOG_ID}/articles.json`;

    // Headers for the request
    const headers = {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ACCESS_TOKEN,
    };

    try {
        const response = await fetch(createArticleUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(articleData),
        });

        const responseData = await response.json();
        if (response.status === 201) {
            console.log('Article created successfully on Shopify.');
        } else {
            console.log('Failed to create article on Shopify.');
            console.log('Error:', responseData);
        }
    } catch (error) {
        console.error('Error creating article on Shopify:', error.message);
    }
}

async function isValidQuestion(isValid, userMessage, AIResponse) {
    console.log('isValid ', isValid);
    if (isValid == 'true') {
        createArticleOnShopify(userMessage, AIResponse);
    }
}

app.post("/chat", (req, res) => {
    console.log('/chat received');

    // Manually collect the raw request body
    let rawBody = '';
    req.on('data', chunk => {
        rawBody += chunk.toString();
    });

    req.on('end', async () => {
        try {
            // Try to parse the raw body as JSON first
            const parsedBody = JSON.parse(rawBody);

            const { message } = parsedBody;

            if (!message) {
                return res.status(400).json({ error: 'No message received' });
            }

            console.log(`Received message: ${message}`);

            // Now sanitize the message to replace control characters with '-n-'
            const sanitizedMessage = message.replace(/[\u0000-\u0019]+/g, '-n-');

            // Split the sanitized message by '-n-' into an array of lines
            const messageLines = sanitizedMessage.split('-n-').filter(line => line.trim() !== '');
            
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
                if (responseMessage.tool_calls) {
                    const availableFunctions = {
                        isValidQuestion: (args) => isValidQuestion(args, line, response),
                    };
                    for (const toolCall of toolCalls) {
                        const functionName = toolCall.function.name;
                        const functionToCall = availableFunctions[functionName];
                        const functionArgs = JSON.parse(toolCall.function.arguments);
                        console.log('functionArgs ', functionArgs)
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



port = 8080;

app.listen(port, () => {
    console.log("Server running on port 8080");
});

