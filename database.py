import sqlite3
import os
from datetime import datetime
import json

class FeedbackDatabase:
    def __init__(self, db_path="youtube_voice_agent.db"):
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """Initialize the database with required tables"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Create user_interactions table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_interactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                query TEXT NOT NULL,
                video_id TEXT NOT NULL,
                chunk_start_time REAL NOT NULL,
                chunk_end_time REAL NOT NULL,
                chunk_text TEXT NOT NULL,
                relevance_score REAL,
                action_type TEXT NOT NULL,  -- 'click', 'view', 'skip'
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                time_spent INTEGER DEFAULT 0  -- seconds spent viewing
            )
        ''')
        
        # Create chunk_ratings table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chunk_ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT NOT NULL,
                video_id TEXT NOT NULL,
                chunk_start_time REAL NOT NULL,
                chunk_end_time REAL NOT NULL,
                chunk_text TEXT NOT NULL,
                relevance_score REAL,
                user_rating INTEGER NOT NULL CHECK (user_rating >= 1 AND user_rating <= 5),
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                session_id TEXT
            )
        ''')
        
        # Create query_history table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS query_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT NOT NULL,
                results_count INTEGER DEFAULT 0,
                videos_count INTEGER DEFAULT 0,
                avg_relevance_score REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                session_id TEXT
            )
        ''')
        
        # Create indexes for better performance
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_interactions_query ON user_interactions(query)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_interactions_video ON user_interactions(video_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ratings_query ON chunk_ratings(query)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ratings_video ON chunk_ratings(video_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_query_history_query ON query_history(query)')
        
        conn.commit()
        conn.close()
        print("✅ Database initialized successfully")
    
    def log_interaction(self, session_id, query, video_id, chunk_start_time, chunk_end_time, 
                       chunk_text, relevance_score, action_type, time_spent=0):
        """Log user interaction with a chunk"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO user_interactions 
            (session_id, query, video_id, chunk_start_time, chunk_end_time, 
             chunk_text, relevance_score, action_type, time_spent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (session_id, query, video_id, chunk_start_time, chunk_end_time, 
              chunk_text, relevance_score, action_type, time_spent))
        
        conn.commit()
        conn.close()
    
    def save_chunk_rating(self, query, video_id, chunk_start_time, chunk_end_time, 
                         chunk_text, relevance_score, user_rating, session_id):
        """Save user rating for a chunk"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO chunk_ratings 
            (query, video_id, chunk_start_time, chunk_end_time, chunk_text, 
             relevance_score, user_rating, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (query, video_id, chunk_start_time, chunk_end_time, chunk_text, 
              relevance_score, user_rating, session_id))
        
        conn.commit()
        conn.close()
    
    def save_query_history(self, query, results_count, videos_count, avg_relevance_score, session_id):
        """Save query history"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO query_history 
            (query, results_count, videos_count, avg_relevance_score, session_id)
            VALUES (?, ?, ?, ?, ?)
        ''', (query, results_count, videos_count, avg_relevance_score, session_id))
        
        conn.commit()
        conn.close()
    
    def get_query_stats(self, query):
        """Get statistics for a specific query"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                COUNT(*) as search_count,
                AVG(avg_relevance_score) as avg_score,
                AVG(results_count) as avg_results
            FROM query_history 
            WHERE query = ?
        ''', (query,))
        
        result = cursor.fetchone()
        conn.close()
        
        return {
            'search_count': result[0] if result else 0,
            'avg_score': result[1] if result else 0,
            'avg_results': result[2] if result else 0
        }
    
    def get_chunk_feedback(self, video_id, chunk_start_time):
        """Get feedback for a specific chunk"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                AVG(user_rating) as avg_rating,
                COUNT(*) as rating_count
            FROM chunk_ratings 
            WHERE video_id = ? AND chunk_start_time = ?
        ''', (video_id, chunk_start_time))
        
        result = cursor.fetchone()
        conn.close()
        
        return {
            'avg_rating': result[0] if result and result[0] else 0,
            'rating_count': result[1] if result else 0
        }
    
    def get_popular_queries(self, limit=10):
        """Get most popular queries"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT query, COUNT(*) as search_count
            FROM query_history 
            GROUP BY query 
            ORDER BY search_count DESC 
            LIMIT ?
        ''', (limit,))
        
        results = cursor.fetchall()
        conn.close()
        
        return [{'query': row[0], 'count': row[1]} for row in results]

# Initialize database when module is imported
db = FeedbackDatabase()
