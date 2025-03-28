const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const Joi = require('joi');
const NodeCache = require('node-cache');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const users = []; // Temporary in-memory storage
const SECRET_KEY = "your_secret_key"; // Replace with a secure key
const NEWS_API_KEY = "your_newsapi_key"; // Replace with your NewsAPI key
const newsCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// **Authentication Middleware**
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Unauthorized: Token required" });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: "Invalid token" });
        req.user = user;
        next();
    });
};

// **User Registration**
app.post('/users/signup', async (req, res) => {
    const { email, password, preferences } = req.body;
    if (!email || !password || !preferences) {
        return res.status(400).json({ message: "Email, password, and preferences are required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { email, password: hashedPassword, preferences };
    users.push(newUser);

    res.status(200).json({ message: "User registered successfully" });
});

// **User Login**
app.post('/users/login', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign({ email: user.email }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ token });
});

// **Get User Preferences**
app.get('/users/preferences', authenticateToken, (req, res) => {
    const user = users.find(u => u.email === req.user.email);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ preferences: user.preferences });
});

// **Update User Preferences**
app.put('/users/preferences', authenticateToken, (req, res) => {
    const user = users.find(u => u.email === req.user.email);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.preferences = req.body.preferences || user.preferences;
    res.json({ message: "Preferences updated successfully", preferences: user.preferences });
});

// **Fetch News (with caching)**
app.get('/news', authenticateToken, async (req, res) => {
    try {
        const user = users.find(u => u.email === req.user.email);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (!user.preferences || !user.preferences.categories || !user.preferences.languages) {
            return res.status(200).json({ news: [] }); // Return empty array instead of 400 error
        }

        const cacheKey = `${user.preferences.categories.join(',')}-${user.preferences.languages.join(',')}`;
        const cachedNews = newsCache.get(cacheKey);
        if (cachedNews) return res.status(200).json({ news: cachedNews });

        const response = await axios.get(`https://newsapi.org/v2/top-headlines`, {
            params: {
                category: user.preferences.categories.join(','),
                language: user.preferences.languages.join(','),
                apiKey: NEWS_API_KEY,
            },
        });

        newsCache.set(cacheKey, response.data.articles);
        res.status(200).json({ news: response.data.articles });

    } catch (error) {
        res.status(500).json({ message: "Failed to fetch news", error: error.message });
    }
});


// **Search News by Keyword**
app.get('/news/search/:keyword', authenticateToken, async (req, res) => {
    try {
        const keyword = req.params.keyword;
        const response = await axios.get(`https://newsapi.org/v2/everything`, {
            params: { q: keyword, apiKey: NEWS_API_KEY },
        });
        res.json({ news: response.data.articles });
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch search results", error: error.message });
    }
});

// **Mark News as Read/Favorite**
const userNewsData = {}; // Stores read/favorite articles per user

app.post('/news/:id/read', authenticateToken, (req, res) => {
    const user = req.user.email;
    userNewsData[user] = userNewsData[user] || { read: new Set(), favorites: new Set() };
    userNewsData[user].read.add(req.params.id);
    res.json({ message: "Article marked as read" });
});

app.post('/news/:id/favorite', authenticateToken, (req, res) => {
    const user = req.user.email;
    userNewsData[user] = userNewsData[user] || { read: new Set(), favorites: new Set() };
    userNewsData[user].favorites.add(req.params.id);
    res.json({ message: "Article marked as favorite" });
});

app.get('/news/read', authenticateToken, (req, res) => {
    const user = req.user.email;
    res.json({ readArticles: Array.from(userNewsData[user]?.read || []) });
});

app.get('/news/favorites', authenticateToken, (req, res) => {
    const user = req.user.email;
    res.json({ favoriteArticles: Array.from(userNewsData[user]?.favorites || []) });
});

// **Periodic Cache Updates**
setInterval(async () => {
    console.log("Updating cached news...");
    for (const user of users) {
        if (user.preferences.categories && user.preferences.languages) {
            const cacheKey = `${user.preferences.categories.join(',')}-${user.preferences.languages.join(',')}`;
            try {
                const response = await axios.get(`https://newsapi.org/v2/top-headlines`, {
                    params: { category: user.preferences.categories.join(','), language: user.preferences.languages.join(','), apiKey: NEWS_API_KEY },
                });
                newsCache.set(cacheKey, response.data.articles);
            } catch (error) {
                console.error("Failed to update cache: ", error.message);
            }
        }
    }
}, 600000); // Update every 10 minutes

// **Start Server**
app.listen(port, () => console.log(`Server running on port ${port}`));

module.exports = app;
