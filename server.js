import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import fs from 'fs';
import twilio from 'twilio';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Twilio setup
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// CORS configuration
app.use(cors());
app.use(express.json());

// yeh hai server static
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// add middle for dubbing ok
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// hamne ye download kiya hai kyuki photo directory ko save karane ke liye
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    dbName: 'CampusNavigatorDB'
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

const itemSchema = new mongoose.Schema({
    name: String,
    description: String,
    location: String,
    date: { type: Date, default: Date.now },
    status: { type: String, enum: ['lost', 'found'], required: true },
    photo: String,
    claimedBy: String,
    claimDetails: String,
    claimantContact: String,
    claimantRoll: String,
    finderName: String,
    finderContact: String
}, {
    collection: 'Lost-found'
});

const Item = mongoose.model('Item', itemSchema);

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lost-found.html'));
});

// POST route for creating new items
app.post('/api/items', upload.single('photo'), async (req, res) => {
    try {
        if (!req.body.name || !req.body.description || !req.body.location || !req.body.status) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const photoPath = req.file ? `/uploads/${req.file.filename}` : null;
        console.log('Saving photo path:', photoPath);

        const newItem = new Item({
            name: req.body.name,
            description: req.body.description,
            location: req.body.location,
            status: req.body.status,
            photo: photoPath,
            finderName: req.body.status === 'found' ? req.body.finderName : undefined,
            finderContact: req.body.status === 'found' ? req.body.finderContact : undefined
        });

        await newItem.save();
        res.status(201).json(newItem);
    } catch (error) {
        console.error('Error saving item:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET route for fetching all items
app.get('/api/items', async (req, res) => {
    try {
        const items = await Item.find().sort({ date: -1 });
        res.json(items);
    } catch (error) {
        console.error('Error fetching items:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET route for single item details
app.get('/api/items/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }
        res.json(item);
    } catch (error) {
        console.error('Error fetching item:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST route for claiming an item
app.post('/api/items/:id/claim', async (req, res) => {
    try {
        const item = await Item.findByIdAndUpdate(
            req.params.id,
            { 
                claimedBy: req.body.claimedBy,
                claimDetails: req.body.claimDetails,
                claimantContact: req.body.claimantContact,
                claimantRoll: req.body.claimantRoll
            },
            { new: true }
        );
        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }

        // Send notification to the finder if it's a found item
        if (item.status === 'found' && item.finderContact) {
            const message = `Someone has claimed your found item: ${item.name}. 
                Claimant Details:
                Name: ${item.claimedBy}
                Contact: ${item.claimantContact}
                Roll No: ${item.claimantRoll}`;

            try {
                await twilioClient.messages.create({
                    body: message,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: item.finderContact
                });
                console.log('Notification sent to finder');
            } catch (error) {
                console.error('Error sending notification:', error);
            }
        }

        res.json(item);
    } catch (error) {
        console.error('Error claiming item:', error);
        res.status(500).json({ message: error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        message: 'Something went wrong!',
        error: err.message
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Uploads directory: ${uploadsDir}`);
});

