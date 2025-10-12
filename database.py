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
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create judge_evaluations table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS judge_evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT NOT NULL,
                video_id TEXT NOT NULL,
                scores TEXT NOT NULL,  -- JSON array of individual scores [5,3,4,2,5]
                average_score REAL NOT NULL,
                quality_level TEXT NOT NULL,  -- excellent, good, fair, poor
                trigger_decision TEXT NOT NULL,  -- immediate, scheduled, monitor, none
                evaluation_time REAL NOT NULL,  -- Time taken for LLM evaluation
                llm_model TEXT DEFAULT 'gemma:2b',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create indexes for better performance
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_interactions_query ON user_interactions(query)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_interactions_video ON user_interactions(video_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ratings_query ON chunk_ratings(query)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_ratings_video ON chunk_ratings(video_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_query_history_query ON query_history(query)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_judge_evaluations_query ON judge_evaluations(query)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_judge_evaluations_video ON judge_evaluations(video_id)')
        
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
    
    def save_judge_evaluation(self, query, video_id, scores, average_score, quality_level, 
                            trigger_decision, evaluation_time, llm_model='gemma:2b'):
        """Save LLM judge evaluation to database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # Convert scores list to JSON string
            scores_json = json.dumps(scores)
            
            cursor.execute('''
                INSERT INTO judge_evaluations 
                (query, video_id, scores, average_score, quality_level, trigger_decision, 
                 evaluation_time, llm_model)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (query, video_id, scores_json, average_score, quality_level, 
                  trigger_decision, evaluation_time, llm_model))
            
            conn.commit()
            
        except Exception as e:
            print(f"❌ Error saving judge evaluation: {e}")
        finally:
            conn.close()
    
    def get_judge_statistics(self, days_back=7):
        """Get judge evaluation statistics"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            from datetime import datetime, timedelta
            cutoff_date = (datetime.now() - timedelta(days=days_back)).isoformat()
            
            # Get basic stats
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_evaluations,
                    AVG(average_score) as avg_quality,
                    MIN(average_score) as min_quality,
                    MAX(average_score) as max_quality,
                    AVG(evaluation_time) as avg_eval_time
                FROM judge_evaluations 
                WHERE timestamp > ?
            ''', (cutoff_date,))
            
            stats = cursor.fetchone()
            
            # Get quality distribution
            cursor.execute('''
                SELECT quality_level, COUNT(*) as count
                FROM judge_evaluations 
                WHERE timestamp > ?
                GROUP BY quality_level
            ''', (cutoff_date,))
            
            quality_dist = {row[0]: row[1] for row in cursor.fetchall()}
            
            # Get trigger decisions
            cursor.execute('''
                SELECT trigger_decision, COUNT(*) as count
                FROM judge_evaluations 
                WHERE timestamp > ?
                GROUP BY trigger_decision
            ''', (cutoff_date,))
            
            trigger_dist = {row[0]: row[1] for row in cursor.fetchall()}
            
            return {
                'total_evaluations': stats[0] or 0,
                'average_quality': round(stats[1] or 0, 3),
                'min_quality': stats[2] or 0,
                'max_quality': stats[3] or 0,
                'average_evaluation_time': round(stats[4] or 0, 3),
                'quality_distribution': quality_dist,
                'trigger_distribution': trigger_dist
            }
            
        except Exception as e:
            print(f"❌ Error getting judge statistics: {e}")
            return {}
        finally:
            conn.close()

# Initialize database when module is imported
db = FeedbackDatabase()
