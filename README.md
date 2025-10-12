# YouTube Voice Agent with Reinforcement Learning

An intelligent YouTube search and transcript analysis system that learns from user feedback to improve search relevance over time using reinforcement learning techniques.

## 🚀 Features

- **Voice-Activated Search**: Chrome extension with voice commands for YouTube video search
- **Intelligent Transcript Analysis**: Automatic transcript extraction and chunking with timestamps
- **Reinforcement Learning**: Multi-armed bandit algorithm that learns from user feedback
- **Self-Learning Embeddings**: Continuously improving semantic search through model fine-tuning
- **LLM Quality Assessment**: Automated evaluation of search quality using local LLM judge
- **Real-time Analytics**: Weights & Biases integration for monitoring system performance

## 🧠 Reinforcement Learning Components

### 1. Multi-Armed Bandit (`bandit.py`)
- **Algorithm**: Epsilon-greedy bandit for chunk selection optimization
- **Problem Solved**: Learning which transcript chunks are most relevant to user queries
- **Reward Signal**: User ratings (1-5 stars) on chunk relevance
- **Exploration vs Exploitation**: Balances trying new chunks vs showing proven relevant ones

### 2. Self-Learning Pipeline (`self_learning.py`)
- **Algorithm**: Continuous fine-tuning of sentence transformer models
- **Problem Solved**: Adapting embedding model to user preferences over time
- **Training Data**: User feedback ratings converted to similarity scores
- **Model Updates**: Automatic retraining when sufficient feedback is collected

### 3. LLM Judge (`llm_judge.py`)
- **Algorithm**: Quality assessment and adaptive learning triggers
- **Problem Solved**: Detecting when system performance degrades
- **Evaluation**: Uses Ollama + Gemma to score search result relevance
- **Adaptive Response**: Triggers fine-tuning when quality drops below threshold

## 📋 Prerequisites

- Python 3.8+
- Chrome browser
- Ollama (for LLM judge)
- Weights & Biases account (optional)

## 🛠️ Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/youtube-voice-agent.git
cd youtube-voice-agent
```

2. **Install Python dependencies**
```bash
pip install -r requirements.txt
```

3. **Install Ollama and Gemma model**
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull Gemma model
ollama pull gemma:2b
```

4. **Set up Weights & Biases (optional)**
```bash
# Set your W&B API key
export WANDB_API_KEY="your-api-key-here"
```

5. **Install Chrome Extension**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `chrome-extension/` folder

## 🚀 Usage

### Start the Server
```bash
python transcript_server.py
```

The server will start on `http://localhost:5000` with the following endpoints:

### API Endpoints

- `GET /search/<query>` - Search YouTube videos
- `GET /transcript/<video_id>` - Get video transcript
- `POST /batch-transcripts` - Process multiple video transcripts
- `POST /rank-chunks` - Rank transcript chunks by relevance
- `POST /feedback` - Submit user feedback ratings
- `GET /health` - Health check

### Chrome Extension

1. Click the extension icon in Chrome
2. Use voice commands like:
   - "Find videos about machine learning"
   - "Search for Python tutorials"
3. Rate chunks using the star rating system
4. The system learns from your feedback over time

## 🔬 How the RL System Works

### Learning Cycle

1. **User Query**: Voice command triggers video search
2. **Chunk Extraction**: Transcripts are split into timestamped chunks
3. **Initial Ranking**: Semantic similarity using embedding model
4. **Bandit Selection**: Epsilon-greedy algorithm selects chunks to show
5. **User Feedback**: Star ratings provide reward signals
6. **Learning Update**: Bandit and embedding model update from feedback
7. **Quality Assessment**: LLM judge evaluates overall performance
8. **Model Fine-tuning**: Triggered when quality drops below threshold

### Key Algorithms

- **Epsilon-Greedy Bandit**: Balances exploration of new chunks vs exploitation of known good ones
- **Sentence Transformer Fine-tuning**: Adapts embeddings based on user preference patterns
- **Quality-Based Learning Triggers**: Prevents model degradation through continuous monitoring

## 📊 Monitoring & Analytics

The system integrates with Weights & Biases to track:

- User interaction patterns
- Chunk selection performance
- Bandit exploration/exploitation ratios
- Model fine-tuning triggers
- Search quality trends
- System response times

## 🗂️ Project Structure

```
youtube-voice-agent/
├── transcript_server.py      # Main Flask server
├── bandit.py                # Multi-armed bandit implementation
├── self_learning.py         # Model fine-tuning pipeline
├── llm_judge.py            # Quality assessment system
├── database.py             # SQLite database operations
├── wandb_logger.py         # Analytics and logging
├── chrome-extension/       # Chrome extension files
├── models/                 # Saved model checkpoints
├── transcripts/           # Cached video transcripts
└── requirements.txt       # Python dependencies
```

## 🔧 Configuration

### Environment Variables
- `WANDB_API_KEY`: Your Weights & Biases API key
- `OLLAMA_URL`: Ollama server URL (default: http://localhost:11434)

### Bandit Parameters
- `epsilon`: Exploration rate (default: 0.1)
- `decay_rate`: Epsilon decay over time (default: 0.995)
- `min_epsilon`: Minimum exploration rate (default: 0.05)

### Learning Thresholds
- `min_training_samples`: Minimum feedback before retraining (default: 5)
- `fine_tuning_threshold`: Quality score that triggers learning (default: 2.5/5.0)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📈 Performance Metrics

The system tracks several key metrics:

- **User Satisfaction**: Average rating scores over time
- **Learning Efficiency**: How quickly the system adapts to feedback
- **Exploration Rate**: Balance between trying new vs proven content
- **Model Performance**: Embedding similarity vs user ratings correlation
- **Response Time**: System latency for search and ranking operations

## 🔬 Research Applications

This project demonstrates practical applications of:

- **Multi-Armed Bandits** in information retrieval
- **Continuous Learning** in embedding models
- **Human-in-the-Loop** machine learning systems
- **Quality Assessment** using LLM judges
- **Real-time Adaptation** in recommendation systems

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Sentence Transformers for embedding models
- yt-dlp for YouTube data extraction
- Ollama for local LLM inference
- Weights & Biases for experiment tracking
