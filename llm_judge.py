#!/usr/bin/env python3
"""
LLM Judge for Search Quality Assessment
Uses Ollama + Gemma to evaluate search result relevance
"""

import requests
import json
import time
from typing import List, Dict, Tuple
from datetime import datetime, timedelta
import statistics

class LLMJudge:
    def __init__(self, model_name="gemma:2b", ollama_url="http://localhost:11434"):
        self.model_name = model_name
        self.ollama_url = ollama_url
        self.quality_history = []
        self.fine_tuning_threshold = 2.5  # Average score below this triggers fine-tuning
        self.declining_threshold = 3.0    # Trend below this indicates declining quality
        self.history_window = 20          # Number of recent evaluations to track
        
        # Test Ollama connection
        self._test_connection()
        
        # Load recent history from database
        self._load_recent_history()
    
    def _test_connection(self):
        """Test if Ollama is running and model is available"""
        try:
            response = requests.get(f"{self.ollama_url}/api/tags", timeout=5)
            if response.status_code == 200:
                models = [model['name'] for model in response.json().get('models', [])]
                if self.model_name not in models:
                    print(f"⚠️  Model {self.model_name} not found. Available models: {models}")
                    print(f"💡 Run: ollama pull {self.model_name}")
                else:
                    print(f"✅ LLM Judge ready with {self.model_name}")
            else:
                print(f"❌ Ollama not responding. Start with: ollama serve")
        except requests.exceptions.RequestException:
            print(f"❌ Cannot connect to Ollama at {self.ollama_url}")
            print(f"💡 Install Ollama: curl -fsSL https://ollama.ai/install.sh | sh")
    
    def _load_recent_history(self):
        """Load recent judge evaluations from database"""
        try:
            from database import db
            import sqlite3
            
            # Get recent evaluations (last 24 hours)
            cutoff_date = (datetime.now() - timedelta(hours=24)).isoformat()
            
            conn = sqlite3.connect(db.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT query, scores, average_score, timestamp
                FROM judge_evaluations 
                WHERE timestamp > ?
                ORDER BY timestamp DESC
                LIMIT ?
            ''', (cutoff_date, self.history_window))
            
            results = cursor.fetchall()
            conn.close()
            
            # Convert to internal format
            for row in results:
                query, scores_json, average_score, timestamp = row
                scores = json.loads(scores_json)
                
                self.quality_history.append({
                    'timestamp': timestamp,
                    'query': query,
                    'average_score': average_score,
                    'scores': scores
                })
            
            if self.quality_history:
                print(f"📊 Loaded {len(self.quality_history)} recent judge evaluations")
                
        except Exception as e:
            print(f"⚠️  Could not load judge history: {e}")
    
    def _save_evaluation_to_db(self, query, video_id, scores, average_score, quality_level, 
                              trigger_decision, evaluation_time):
        """Save evaluation to database"""
        try:
            from database import db
            db.save_judge_evaluation(
                query=query,
                video_id=video_id,
                scores=scores,
                average_score=average_score,
                quality_level=quality_level,
                trigger_decision=trigger_decision,
                evaluation_time=evaluation_time,
                llm_model=self.model_name
            )
        except Exception as e:
            print(f"⚠️  Could not save judge evaluation to database: {e}")
    
    def _fallback_scoring(self, query: str, results: List[Dict]) -> List[int]:
        """Simple heuristic scoring when LLM is unavailable"""
        scores = []
        query_words = set(query.lower().split())
        
        for result in results[:5]:
            text = result.get('text', '').lower()
            
            # Count query word matches
            text_words = set(text.split())
            matches = len(query_words.intersection(text_words))
            
            # Simple scoring based on word overlap
            if matches >= len(query_words) * 0.8:  # 80%+ match
                score = 5
            elif matches >= len(query_words) * 0.6:  # 60%+ match
                score = 4
            elif matches >= len(query_words) * 0.4:  # 40%+ match
                score = 3
            elif matches >= len(query_words) * 0.2:  # 20%+ match
                score = 2
            else:
                score = 1
            
            scores.append(score)
        
        return scores
    
    def create_judge_prompt(self, query: str, results: List[Dict]) -> str:
        """Create evaluation prompt for the LLM"""
        prompt = f"""You are an expert search quality evaluator. Rate how well each search result matches the user's query.

RATING SCALE:
5 = Perfect match - directly answers the query with high relevance
4 = Highly relevant - mostly on-topic and useful  
3 = Somewhat relevant - partially useful, some connection to query
2 = Loosely related - minimal value, weak connection
1 = Irrelevant - completely off-topic or unrelated

Query: "{query}"

Search Results:
"""
        
        for i, result in enumerate(results[:5], 1):  # Limit to top 5 results
            # Truncate long text for efficiency
            text = result.get('text', '')[:200]
            if len(result.get('text', '')) > 200:
                text += "..."
            prompt += f"{i}. {text}\n"
        
        prompt += f"""
Rate each result (1-5). Respond with ONLY the scores in this format:
[score1, score2, score3, score4, score5]

Example: [5, 3, 1, 4, 2]

Scores:"""
        
        return prompt
    
    def query_ollama(self, prompt: str) -> str:
        """Send prompt to Ollama and get response"""
        try:
            payload = {
                "model": self.model_name,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.1,  # Low temperature for consistent scoring
                    "top_p": 0.9,
                    "num_predict": 50    # Short response expected
                }
            }
            
            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json=payload,
                timeout=30
            )
            
            if response.status_code == 200:
                return response.json().get('response', '').strip()
            else:
                print(f"❌ Ollama error: {response.status_code}")
                if response.status_code == 404:
                    print(f"💡 Model '{self.model_name}' not found. Run: ollama pull {self.model_name}")
                return ""
                
        except requests.exceptions.RequestException as e:
            print(f"❌ Ollama request failed: {e}")
            return ""
    
    def parse_scores(self, response: str) -> List[int]:
        """Parse LLM response to extract numerical scores"""
        try:
            # Look for pattern like [5, 3, 1, 4, 2]
            import re
            pattern = r'\[([0-9,\s]+)\]'
            match = re.search(pattern, response)
            
            if match:
                scores_str = match.group(1)
                scores = [int(s.strip()) for s in scores_str.split(',')]
                # Validate scores are in range 1-5
                scores = [max(1, min(5, score)) for score in scores]
                return scores
            else:
                # Fallback: look for individual numbers
                numbers = re.findall(r'\b[1-5]\b', response)
                if numbers:
                    return [int(n) for n in numbers[:5]]
                else:
                    print(f"⚠️  Could not parse scores from: {response}")
                    return [3] * 5  # Default neutral scores
                    
        except Exception as e:
            print(f"❌ Score parsing error: {e}")
            return [3] * 5  # Default neutral scores
    
    def evaluate_search_quality(self, query: str, results: List[Dict]) -> Dict:
        """Evaluate search results and return quality assessment"""
        start_time = time.time()
        
        if not results:
            return {
                'scores': [],
                'average_score': 0.0,
                'quality_level': 'no_results',
                'trigger_fine_tuning': False,
                'evaluation_time': 0.0
            }
        
        # Create and send prompt
        prompt = self.create_judge_prompt(query, results)
        response = self.query_ollama(prompt)
        
        if not response:
            # Fallback if LLM fails - use simple heuristic scoring
            fallback_scores = self._fallback_scoring(query, results)
            fallback_avg = statistics.mean(fallback_scores) if fallback_scores else 3.0
            
            return {
                'scores': fallback_scores,
                'average_score': fallback_avg,
                'quality_level': 'llm_error',
                'trigger_fine_tuning': False,
                'evaluation_time': time.time() - start_time
            }
        
        # Parse scores
        scores = self.parse_scores(response)
        scores = scores[:len(results)]  # Match number of results
        
        # Calculate metrics
        average_score = statistics.mean(scores) if scores else 0.0
        evaluation_time = time.time() - start_time
        
        # Determine quality level
        if average_score >= 4.0:
            quality_level = 'excellent'
        elif average_score >= 3.5:
            quality_level = 'good'
        elif average_score >= 2.5:
            quality_level = 'fair'
        else:
            quality_level = 'poor'
        
        # Update history
        self.quality_history.append({
            'timestamp': datetime.now().isoformat(),
            'query': query,
            'average_score': average_score,
            'scores': scores
        })
        
        # Keep only recent history
        if len(self.quality_history) > self.history_window:
            self.quality_history = self.quality_history[-self.history_window:]
        
        # Determine if fine-tuning should be triggered
        trigger_decision = self._should_trigger_fine_tuning(average_score)
        
        # Save to database (async to not block response)
        try:
            self._save_evaluation_to_db(
                query=query,
                video_id=results[0].get('video_id', 'unknown') if results else 'unknown',
                scores=scores,
                average_score=average_score,
                quality_level=quality_level,
                trigger_decision=trigger_decision,
                evaluation_time=evaluation_time
            )
        except Exception as e:
            print(f"⚠️  Database save failed: {e}")
        
        return {
            'scores': scores,
            'average_score': average_score,
            'quality_level': quality_level,
            'trigger_fine_tuning': trigger_decision,
            'evaluation_time': evaluation_time,
            'llm_response': response
        }
    
    def _should_trigger_fine_tuning(self, current_score: float) -> str:
        """Determine if and when fine-tuning should be triggered"""
        
        # Immediate trigger for very poor quality
        if current_score < 2.0:
            return 'immediate'
        
        # Check recent trend if we have enough history
        if len(self.quality_history) >= 5:
            recent_scores = [entry['average_score'] for entry in self.quality_history[-5:]]
            recent_average = statistics.mean(recent_scores)
            
            # Trigger if recent average is poor
            if recent_average < self.fine_tuning_threshold:
                return 'immediate'
            
            # Check for declining trend
            if len(self.quality_history) >= 10:
                older_scores = [entry['average_score'] for entry in self.quality_history[-10:-5]]
                older_average = statistics.mean(older_scores)
                
                # If quality is declining significantly
                if older_average - recent_average > 0.5:
                    return 'scheduled'
        
        # Single poor score but not critical
        if current_score < self.fine_tuning_threshold:
            return 'monitor'
        
        return 'none'
    
    def get_quality_stats(self) -> Dict:
        """Get quality statistics and trends from database"""
        try:
            from database import db
            
            # Get comprehensive stats from database
            db_stats = db.get_judge_statistics(days_back=7)
            
            # Add memory-based trend analysis
            if self.quality_history and len(self.quality_history) >= 10:
                scores = [entry['average_score'] for entry in self.quality_history]
                recent = statistics.mean(scores[-5:])
                older = statistics.mean(scores[-10:-5])
                
                if recent > older + 0.2:
                    trend = 'improving'
                elif recent < older - 0.2:
                    trend = 'declining'
                else:
                    trend = 'stable'
            else:
                trend = 'insufficient_data'
            
            # Combine database stats with trend analysis
            db_stats['trend'] = trend
            db_stats['memory_evaluations'] = len(self.quality_history)
            
            return db_stats
            
        except Exception as e:
            print(f"⚠️  Error getting database stats: {e}")
            
            # Fallback to memory-only stats
            if not self.quality_history:
                return {
                    'total_evaluations': 0,
                    'average_quality': 0.0,
                    'trend': 'no_data'
                }
            
            scores = [entry['average_score'] for entry in self.quality_history]
            
            return {
                'total_evaluations': len(self.quality_history),
                'average_quality': statistics.mean(scores),
                'min_quality': min(scores),
                'max_quality': max(scores),
                'recent_quality': statistics.mean(scores[-5:]) if len(scores) >= 5 else statistics.mean(scores),
                'trend': 'memory_only'
            }

# Global judge instance
llm_judge = None

def initialize_llm_judge(model_name="gemma:2b"):
    """Initialize the LLM judge"""
    global llm_judge
    if llm_judge is None:
        llm_judge = LLMJudge(model_name=model_name)
    return llm_judge

def evaluate_search_results(query: str, results: List[Dict]) -> Dict:
    """Evaluate search results using the LLM judge"""
    judge = initialize_llm_judge()
    return judge.evaluate_search_quality(query, results)

if __name__ == "__main__":
    # Test the judge
    judge = LLMJudge()
    
    # Test evaluation
    test_query = "machine learning algorithms"
    test_results = [
        {"text": "Neural networks are a type of machine learning algorithm that mimics the human brain"},
        {"text": "Today's weather is sunny with a chance of rain"},
        {"text": "Support vector machines are powerful classification algorithms"}
    ]
    
    evaluation = judge.evaluate_search_quality(test_query, test_results)
    print("🔍 Test Evaluation:")
    print(f"Query: {test_query}")
    print(f"Scores: {evaluation['scores']}")
    print(f"Average: {evaluation['average_score']:.2f}")
    print(f"Quality: {evaluation['quality_level']}")
    print(f"Trigger: {evaluation['trigger_fine_tuning']}")
