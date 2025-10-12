import numpy as np
import json
import os
from datetime import datetime
from collections import defaultdict
import random

class EpsilonGreedyBandit:
    """
    Epsilon-greedy multi-armed bandit for chunk selection.
    Uses user ratings as rewards to learn which chunks are most relevant.
    """
    
    def __init__(self, epsilon=0.1, decay_rate=0.995, min_epsilon=0.05):
        # Bandit parameters
        self.epsilon = epsilon
        self.decay_rate = decay_rate
        self.min_epsilon = min_epsilon
        
        # Chunk statistics
        self.chunk_rewards = defaultdict(list)  # chunk_id -> [rewards]
        self.chunk_counts = defaultdict(int)    # chunk_id -> count
        self.chunk_features = {}                # chunk_id -> features
        
        # Query-specific learning
        self.query_chunk_rewards = defaultdict(lambda: defaultdict(list))
        
        # Performance tracking
        self.total_interactions = 0
        self.exploration_count = 0
        self.exploitation_count = 0
        self.recent_rewards = []
        
        print("🎲 Epsilon-Greedy Bandit initialized")
        print(f"   Initial epsilon: {epsilon}")
        print(f"   Decay rate: {decay_rate}")
    
    def get_chunk_score(self, chunk, query=None, use_query_context=True):
        """Calculate expected reward for a chunk"""
        chunk_id = self._get_chunk_id(chunk)
        
        # Use query-specific rewards if available and requested
        if use_query_context and query and query in self.query_chunk_rewards:
            query_rewards = self.query_chunk_rewards[query][chunk_id]
            if len(query_rewards) >= 2:  # Need at least 2 samples for query-specific
                return np.mean(query_rewards)
        
        # Fall back to global chunk rewards
        if chunk_id in self.chunk_rewards and len(self.chunk_rewards[chunk_id]) > 0:
            return np.mean(self.chunk_rewards[chunk_id])
        
        # Default to embedding similarity for new chunks
        return chunk.get('relevance_score', 0.5)
    
    def select_chunks(self, chunks, query, top_k=10):
        """
        Select and rank chunks using epsilon-greedy strategy
        """
        if not chunks:
            return []
        
        ranked_chunks = []
        
        for chunk in chunks:
            chunk_id = self._get_chunk_id(chunk)
            
            # Epsilon-greedy decision
            if random.random() < self.epsilon:
                # Explore: Add randomness to encourage trying different chunks
                base_score = self.get_chunk_score(chunk, query)
                exploration_bonus = random.uniform(0, 0.5)
                final_score = base_score + exploration_bonus
                
                self.exploration_count += 1
                chunk['selection_type'] = 'explore'
                
            else:
                # Exploit: Use learned expected reward
                final_score = self.get_chunk_score(chunk, query)
                
                self.exploitation_count += 1
                chunk['selection_type'] = 'exploit'
            
            chunk['bandit_score'] = final_score
            ranked_chunks.append(chunk)
        
        # Sort by bandit score (highest first)
        ranked_chunks.sort(key=lambda x: x['bandit_score'], reverse=True)
        
        # Decay epsilon over time
        self._decay_epsilon()
        
        print(f"🎲 Ranked {len(chunks)} chunks (ε={self.epsilon:.3f})")
        print(f"   Exploration: {self.exploration_count}, Exploitation: {self.exploitation_count}")
        
        return ranked_chunks[:top_k]
    
    def update_reward(self, chunk, query, rating, relevance_score=None):
        """
        Update bandit with user feedback
        
        Args:
            chunk: Chunk object or dict
            query: Search query string
            rating: User rating (1-5 stars)
            relevance_score: Optional embedding similarity score
        """
        chunk_id = self._get_chunk_id(chunk)
        
        # Convert 1-5 star rating to 0-1 reward
        reward = (rating - 1) / 4.0
        
        # Store global chunk reward
        self.chunk_rewards[chunk_id].append(reward)
        self.chunk_counts[chunk_id] += 1
        
        # Store query-specific reward
        self.query_chunk_rewards[query][chunk_id].append(reward)
        
        # Store chunk features for future use
        self.chunk_features[chunk_id] = {
            'relevance_score': relevance_score or chunk.get('relevance_score', 0),
            'text_length': len(chunk.get('text', '')),
            'duration': chunk.get('duration', 0),
            'start_time': chunk.get('start_time', 0)
        }
        
        # Track recent performance
        self.recent_rewards.append(reward)
        if len(self.recent_rewards) > 50:  # Keep last 50 rewards
            self.recent_rewards.pop(0)
        
        self.total_interactions += 1
        
        print(f"🎲 Updated bandit: chunk {chunk_id[:8]}... got {rating}★ (reward={reward:.2f})")
        print(f"   Chunk avg: {np.mean(self.chunk_rewards[chunk_id]):.3f} ({len(self.chunk_rewards[chunk_id])} samples)")
        
        # Adaptive epsilon based on performance
        self._adapt_epsilon()
    
    def get_performance_stats(self):
        """Get current bandit performance statistics"""
        if not self.recent_rewards:
            return {}
        
        total_chunks_learned = len(self.chunk_rewards)
        avg_recent_reward = np.mean(self.recent_rewards)
        exploration_rate = self.exploration_count / max(1, self.total_interactions)
        
        # Find best performing chunks
        best_chunks = []
        for chunk_id, rewards in self.chunk_rewards.items():
            if len(rewards) >= 3:  # At least 3 samples
                avg_reward = np.mean(rewards)
                best_chunks.append((chunk_id, avg_reward, len(rewards)))
        
        best_chunks.sort(key=lambda x: x[1], reverse=True)
        
        return {
            'total_interactions': self.total_interactions,
            'chunks_learned': total_chunks_learned,
            'avg_recent_reward': avg_recent_reward,
            'current_epsilon': self.epsilon,
            'exploration_rate': exploration_rate,
            'exploitation_rate': 1 - exploration_rate,
            'best_chunks': best_chunks[:5],  # Top 5 chunks
            'queries_learned': len(self.query_chunk_rewards)
        }
    
    def _get_chunk_id(self, chunk):
        """Generate unique ID for chunk"""
        if isinstance(chunk, dict):
            # Use video_id + start_time as unique identifier
            video_id = chunk.get('video_id', 'unknown')
            start_time = chunk.get('start_time', 0)
            return f"{video_id}_{start_time}"
        return str(chunk)
    
    def _decay_epsilon(self):
        """Gradually reduce exploration rate"""
        if self.epsilon > self.min_epsilon:
            self.epsilon *= self.decay_rate
    
    def _adapt_epsilon(self):
        """Adapt epsilon based on recent performance"""
        if len(self.recent_rewards) < 10:
            return
        
        recent_avg = np.mean(self.recent_rewards[-10:])
        older_avg = np.mean(self.recent_rewards[-20:-10]) if len(self.recent_rewards) >= 20 else recent_avg
        
        # If performance is improving, reduce exploration
        if recent_avg > older_avg + 0.1:
            self.epsilon = max(self.min_epsilon, self.epsilon * 0.9)
        # If performance is declining, increase exploration
        elif recent_avg < older_avg - 0.1:
            self.epsilon = min(0.3, self.epsilon * 1.1)
    
    def save_state(self, filepath="bandit_state.json"):
        """Save bandit state to file"""
        state = {
            'epsilon': self.epsilon,
            'chunk_rewards': dict(self.chunk_rewards),
            'chunk_counts': dict(self.chunk_counts),
            'chunk_features': self.chunk_features,
            'query_chunk_rewards': {q: dict(chunks) for q, chunks in self.query_chunk_rewards.items()},
            'total_interactions': self.total_interactions,
            'exploration_count': self.exploration_count,
            'exploitation_count': self.exploitation_count,
            'recent_rewards': self.recent_rewards,
            'timestamp': datetime.now().isoformat()
        }
        
        with open(filepath, 'w') as f:
            json.dump(state, f, indent=2)
        
        print(f"💾 Bandit state saved to {filepath}")
    
    def load_state(self, filepath="bandit_state.json"):
        """Load bandit state from file"""
        if not os.path.exists(filepath):
            print(f"⚠️  No saved state found at {filepath}")
            return False
        
        try:
            with open(filepath, 'r') as f:
                state = json.load(f)
            
            self.epsilon = state.get('epsilon', self.epsilon)
            self.chunk_rewards = defaultdict(list, state.get('chunk_rewards', {}))
            self.chunk_counts = defaultdict(int, state.get('chunk_counts', {}))
            self.chunk_features = state.get('chunk_features', {})
            
            # Restore query-specific rewards
            query_rewards = state.get('query_chunk_rewards', {})
            self.query_chunk_rewards = defaultdict(lambda: defaultdict(list))
            for query, chunks in query_rewards.items():
                for chunk_id, rewards in chunks.items():
                    self.query_chunk_rewards[query][chunk_id] = rewards
            
            self.total_interactions = state.get('total_interactions', 0)
            self.exploration_count = state.get('exploration_count', 0)
            self.exploitation_count = state.get('exploitation_count', 0)
            self.recent_rewards = state.get('recent_rewards', [])
            
            print(f"📂 Bandit state loaded from {filepath}")
            print(f"   Interactions: {self.total_interactions}")
            print(f"   Chunks learned: {len(self.chunk_rewards)}")
            print(f"   Current epsilon: {self.epsilon:.3f}")
            
            return True
            
        except Exception as e:
            print(f"❌ Error loading bandit state: {e}")
            return False

# Global bandit instance
bandit = EpsilonGreedyBandit()

# Load existing state on import
bandit.load_state()
