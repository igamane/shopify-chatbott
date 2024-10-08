require("dotenv").config(); // Load environment variables from .env file
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { JSDOM } = require('jsdom');
const { storage, cloudinary } = require('./cloudinary');
const multer = require('multer');
const upload = multer({ storage });
const axios = require('axios'); // Needed to download the image before uploading to Cloudinary
const stream = require('stream'); // Importing the 'stream' module

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

    // Remove sequences of hyphens (--) or more, and underscores (__) or more
    text = text.replace(/-{2,}/g, '');  // Remove '--', '---', '----'...
    text = text.replace(/_{2,}/g, '');  // Remove '__', '___', '____'...

    return text;
}

async function insertProductPromotion(htmlContent, blogTopic) {
    const { window } = new JSDOM(htmlContent);
    const { document } = window;

    // Detect product data from environment variables
    const products = [];
    let messages = [
        {
            "role": "user",
            "content": `Generate 4 different text-to-image prompts based on the blog article topic: "${blogTopic}".\n\n Each prompt should start with "Generate an image" and should describe a completely unique and detailed visual concept that reflects the blog article's topic. Ensure each image prompt is distinct from the others, with a different style, perspective, and composition.`
        }
    ];

    const tools = [
        {
            "type": "function",
            "function": {
                "name": "generate_blog_article_images",
                "description": "A function to generate 4 blog article images using a text-to-image AI model. Each image will be based on a specific prompt related to the blog topic provided.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt1": {
                            "type": "string",
                            "description": "The first detailed prompt to generate an image for the blog article starting by -generate an image ...-."
                        },
                        "prompt2": {
                            "type": "string",
                            "description": "The second detailed prompt to generate an image for the blog article starting by -generate an image ...-."
                        },
                        "prompt3": {
                            "type": "string",
                            "description": "The third detailed prompt to generate an image for the blog article starting by -generate an image ...-."
                        },
                        "prompt4": {
                            "type": "string",
                            "description": "The fourth detailed prompt to generate an image for the blog article starting by -generate an image ...-."
                        }
                    },
                    "required": [
                        "prompt1",
                        "prompt2",
                        "prompt3",
                        "prompt4"
                    ]
                }
            }
        }

    ];

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        tools: tools,
        tool_choice: { "type": "function", "function": { "name": "generate_blog_article_images" } },
    });
    const responseMessage = response.choices[0].message;

    console.log(responseMessage);
    let result_table;

    const toolCalls = responseMessage.tool_calls;
    if (responseMessage.tool_calls) {

        for (const toolCall of toolCalls) {
            result_table = JSON.parse(toolCall.function.arguments);
            console.log(result_table);

            const uploadImageToCloudinary = async (imageUrl) => {
                const response = await axios({
                    url: imageUrl,
                    method: 'GET',
                    responseType: 'arraybuffer'
                });
                const buffer = Buffer.from(response.data, 'binary');
                
                return new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        { resource_type: 'image' },
                        (error, result) => {
                            if (error) reject(error);
                            else resolve(result);
                        }
                    );
                    const bufferStream = new stream.PassThrough();
                    bufferStream.end(buffer);
                    bufferStream.pipe(uploadStream);
                });
            };

            const image1 = await openai.images.generate({ model: "dall-e-3", prompt: `${result_table.prompt1} - DO NOT INCLUDE ANY TEXT` });
            const imageUrl1 = image1.data[0].url;
            const cloudinaryUrl1 = await uploadImageToCloudinary(imageUrl1);
            console.log(cloudinaryUrl1);
            console.log(cloudinaryUrl1.url);
            products.push({
                image: cloudinaryUrl1.url,
                prompt: result_table.prompt1,
                position: 'TOP'
            });
            const image2 = await openai.images.generate({ model: "dall-e-3", prompt: `${result_table.prompt2} - DO NOT INCLUDE ANY TEXT` });
            const imageUrl2 = image2.data[0].url;
            const cloudinaryUrl2 = await uploadImageToCloudinary(imageUrl2);
            console.log(cloudinaryUrl2.url);
            products.push({
                image: cloudinaryUrl2.url,
                prompt: result_table.prompt2,
                position: 'MIDDLE1'
            });
            const image3 = await openai.images.generate({ model: "dall-e-3", prompt: `${result_table.prompt3} - DO NOT INCLUDE ANY TEXT` });
            const imageUrl3 = image3.data[0].url;
            const cloudinaryUrl3 = await uploadImageToCloudinary(imageUrl3);
            console.log(cloudinaryUrl3.url);
            products.push({
                image: cloudinaryUrl3.url,
                prompt: result_table.prompt3,
                position: 'MIDDLE2'
            });
            const image4 = await openai.images.generate({ model: "dall-e-3", prompt: `${result_table.prompt4} - DO NOT INCLUDE ANY TEXT` });
            const imageUrl4 = image4.data[0].url;
            const cloudinaryUrl4 = await uploadImageToCloudinary(imageUrl4);
            console.log(cloudinaryUrl4.url);
            products.push({
                image: cloudinaryUrl4.url,
                prompt: result_table.prompt4,
                position: 'END'
            });
        }
    }

    // First, calculate the total number of <p> elements and how many sections we can divide them into
    const pElements = document.querySelectorAll('p');
    const totalPElements = pElements.length;

    // Calculate how many images can be inserted based on the number of paragraphs
    let sections;
    if (totalPElements < 5) {
        sections = 2; // If there are fewer than 5 <p> elements, insert 2 images
    } else if (totalPElements < 8) {
        sections = 3; // If there are between 5 and 7 <p> elements, insert 3 images
    } else {
        sections = 4; // If there are 8 or more <p> elements, insert 4 images
    }

    // Calculate where to insert images
    const pPerSection = Math.floor(totalPElements / (sections + 1));

    // Ensure we don't insert the same image in all positions
    products.slice(0, sections).forEach((product, index) => {
        let productPrompt = product.prompt;
        let adjustedProductPrompt = productPrompt.replace('generate ', '');
        const clickableImage = `<img src="${product.image}" alt="${adjustedProductPrompt}" style="width:100%; height:auto;">`;

        // Find the position to insert the image
        const insertAfterIndex = (index + 1) * pPerSection - 1;
        if (insertAfterIndex < totalPElements && pElements[insertAfterIndex]) {
            pElements[insertAfterIndex].insertAdjacentHTML('afterend', clickableImage);
        }
    });


    return document.documentElement.innerHTML;
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
    let htmlContent = convertNewLinesAndBold(content);
    htmlContent = await insertProductPromotion(htmlContent, metaDescription);
    const htmlmetaDescription = convertNewLinesAndBold(metaDescription);
    metaDescription = metaDescription.replace(/\n/g, '');
    console.log(adjustedTitle);
    const image = await openai.images.generate({ model: "dall-e-3", prompt: `generate a featured image for an article with topic: ${metaDescription}` });
    const imageUrl = image.data[0].url;
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
            ],
            image: {
                src: imageUrl // Include the image URL
            }
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
        await createArticleOnShopify(userMessage, AIResponse);
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
            // Remove any invalid control characters without affecting valid JSON structure
            rawBody = rawBody.replace(/[\u0000-\u0019]+/g, ''); // Remove any invalid control characters

            // Try to parse the sanitized body as JSON
            const parsedBody = JSON.parse(rawBody);
            let { message } = parsedBody;
            if (!message) {
                return res.status(400).json({ error: 'No message received' });
            }

            message = message.replace(/[\u0000-\u0019]+/g, '');

            console.log(`Received message: ${message}`);

            // Split the message by new lines into an array of lines
            const messageLines = message.split(/(?<=\?)/).filter(line => line.trim() !== '');

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

            console.log(responses);

            // Return all the responses in an array
            res.json({ responses });

            // Wait for 1 minute and 10 seconds before moving to the next line
            await new Promise(resolve => setTimeout(resolve, 60 * 1000)); // 70 seconds

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
