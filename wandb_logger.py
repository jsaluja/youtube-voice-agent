import wandb
import os
from datetime import datetime
import json

class WandBLogger:
    """
    Weights & Biases logger for ReflexAgent RL monitoring
    Tracks user interactions, bandit performance, and learning metrics
    """
    
    def __init__(self, project_name="reflex-agent-hackathon", entity=None):
        self.project_name = project_name
        self.entity = entity
        self.run = None
        self.is_initialized = False
        
        # Initialize W&B
        self.initialize()
    
    def initialize(self):
        """Initialize W&B run - simple and non-blocking"""
        try:
            # Quick W&B setup - don't block server startup
            import wandb
            
            # Simple initialization without complex settings
            self.run = wandb.init(
                project=self.project_name,
                name="ReflexAgent Session",
                mode="online"
            )
            
            self.is_initialized = True
            print("✅ W&B initialized successfully")
            
        except Exception as e:
            print(f"⚠️  W&B initialization failed: {e}")
            print("🔄 Server continuing without W&B logging")
            self.is_initialized = False
            self.run = None
    
    
    
    def log_search_query(self, query, video_count, chunk_count):
        """Log search query and results"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            # Single log call with all search data
            log_data = {
                "search/query_length": len(query),
                "search/videos_found": video_count,
                "search/chunks_generated": chunk_count,
                "search/timestamp": datetime.now().timestamp(),
                "search/query": query
            }
            self.run.log(log_data)
            
        except Exception as e:
            print(f"❌ W&B search logging failed: {e}")
    
    def log_user_rating(self, query, chunk_id, rating, relevance_score, bandit_score=None):
        """Log user rating feedback"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            # Convert 1-5 rating to 0-1 reward
            reward = (rating - 1) / 4.0
            
            # Combine all logs into a single call to prevent multiple runs
            log_data = {
                "feedback/user_rating": rating,
                "feedback/reward": reward,
                "feedback/relevance_score": relevance_score,
                "feedback/rating_timestamp": datetime.now().timestamp(),
                "feedback/query_rating": f"{query}:{rating}",
                "feedback/chunk_performance": f"{chunk_id[:8]}:{rating}"
            }
            
            if bandit_score is not None:
                log_data["feedback/bandit_score"] = bandit_score
            
            # Single log call to prevent race conditions
            self.run.log(log_data)
            
        except Exception as e:
            print(f"❌ W&B rating logging failed: {e}")
    
    def log_bandit_metrics(self, bandit_stats):
        """Log bandit performance metrics"""
        if not self.is_initialized or not bandit_stats or not self.run:
            return
        
        try:
            # Combine all bandit metrics into single log call
            log_data = {
                "bandit/total_interactions": bandit_stats.get('total_interactions', 0),
                "bandit/chunks_learned": bandit_stats.get('chunks_learned', 0),
                "bandit/avg_recent_reward": bandit_stats.get('avg_recent_reward', 0),
                "bandit/current_epsilon": bandit_stats.get('current_epsilon', 0),
                "bandit/exploration_rate": bandit_stats.get('exploration_rate', 0),
                "bandit/exploitation_rate": bandit_stats.get('exploitation_rate', 0),
                "bandit/queries_learned": bandit_stats.get('queries_learned', 0)
            }
            
            # Add best performing chunks to the same log call
            best_chunks = bandit_stats.get('best_chunks', [])
            if best_chunks:
                for i, (chunk_id, avg_reward, count) in enumerate(best_chunks[:3]):
                    log_data[f"bandit/top_chunk_{i+1}_reward"] = avg_reward
                    log_data[f"bandit/top_chunk_{i+1}_count"] = count
            
            # Single log call for all bandit metrics
            self.run.log(log_data)
            print(f"✅ Logged bandit metrics to W&B: {bandit_stats.get('total_interactions', 0)} interactions, ε={bandit_stats.get('current_epsilon', 0):.3f}")
            
        except Exception as e:
            print(f"❌ W&B bandit logging failed: {e}")
    
    def log_chunk_selection(self, chunks_selected, exploration_count, exploitation_count):
        """Log chunk selection decisions"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            total_selections = exploration_count + exploitation_count
            exploration_ratio = exploration_count / max(1, total_selections)
            
            self.run.log({
                "selection/chunks_selected": chunks_selected,
                "selection/exploration_count": exploration_count,
                "selection/exploitation_count": exploitation_count,
                "selection/exploration_ratio": exploration_ratio,
                "selection/timestamp": datetime.now().timestamp()
            })
            
        except Exception as e:
            print(f"❌ W&B selection logging failed: {e}")
    
    def log_learning_progress(self, session_rewards, cumulative_reward, learning_rate=None):
        """Log learning progress over time"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            log_data = {
                "learning/session_avg_reward": sum(session_rewards) / max(1, len(session_rewards)),
                "learning/cumulative_reward": cumulative_reward,
                "learning/session_length": len(session_rewards),
                "learning/reward_variance": self._calculate_variance(session_rewards)
            }
            
            if learning_rate:
                log_data["learning/learning_rate"] = learning_rate
            
            self.run.log(log_data)
            
        except Exception as e:
            print(f"❌ W&B learning logging failed: {e}")
    
    def log_query_performance(self, query, avg_rating, interaction_count, improvement_rate=None):
        """Log query-specific performance"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            log_data = {
                "query_performance/avg_rating": avg_rating,
                "query_performance/interaction_count": interaction_count,
                "query_performance/query_hash": hash(query) % 10000  # Anonymous query tracking
            }
            
            if improvement_rate:
                log_data["query_performance/improvement_rate"] = improvement_rate
            
            self.run.log(log_data)
            
        except Exception as e:
            print(f"❌ W&B query performance logging failed: {e}")
    
    def log_system_metrics(self, response_time, memory_usage=None, cpu_usage=None):
        """Log system performance metrics"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            log_data = {
                "system/response_time_ms": response_time * 1000,
                "system/timestamp": datetime.now().timestamp()
            }
            
            if memory_usage:
                log_data["system/memory_usage_mb"] = memory_usage
            if cpu_usage:
                log_data["system/cpu_usage_percent"] = cpu_usage
            
            self.run.log(log_data)
            
        except Exception as e:
            print(f"❌ W&B system logging failed: {e}")
    
    def log_experiment_summary(self, total_searches, total_ratings, avg_improvement):
        """Log experiment summary for demo purposes"""
        if not self.is_initialized:
            return
        
        try:
            wandb.summary.update({
                "experiment/total_searches": total_searches,
                "experiment/total_ratings": total_ratings,
                "experiment/avg_improvement": avg_improvement,
                "experiment/completion_time": datetime.now().isoformat()
            })
            
            print(f"📊 Experiment summary logged to W&B")
            
        except Exception as e:
            print(f"❌ W&B summary logging failed: {e}")
    
    def create_demo_dashboard(self):
        """Create a demo dashboard configuration"""
        if not self.is_initialized:
            return None
        
        dashboard_config = {
            "charts": [
                {
                    "title": "Learning Curve - Average Reward Over Time",
                    "type": "line",
                    "metrics": ["bandit/avg_recent_reward"],
                    "description": "Shows how the agent's performance improves with user feedback"
                },
                {
                    "title": "Exploration vs Exploitation",
                    "type": "bar",
                    "metrics": ["bandit/exploration_rate", "bandit/exploitation_rate"],
                    "description": "Balance between trying new chunks vs using learned preferences"
                },
                {
                    "title": "User Satisfaction Trend",
                    "type": "line",
                    "metrics": ["feedback/user_rating"],
                    "description": "User ratings over time showing satisfaction improvement"
                },
                {
                    "title": "System Performance",
                    "type": "line",
                    "metrics": ["system/response_time_ms"],
                    "description": "System response time and performance metrics"
                }
            ]
        }
        
        return dashboard_config
    
    def _calculate_variance(self, values):
        """Calculate variance of a list of values"""
        if not values:
            return 0
        mean = sum(values) / len(values)
        return sum((x - mean) ** 2 for x in values) / len(values)
    
    def log_model_update(self, version, model_path):
        """Log model update to W&B"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            self.run.log({
                "model/version": version,
                "model/update_timestamp": datetime.now().timestamp(),
                "model/path": model_path
            })
        except Exception as e:
            print(f"❌ W&B model update logging failed: {e}")
    
    def log_fine_tuning_start(self, training_samples, eval_samples):
        """Log fine-tuning start"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            self.run.log({
                "fine_tuning/start_timestamp": datetime.now().timestamp(),
                "fine_tuning/training_samples": training_samples,
                "fine_tuning/eval_samples": eval_samples,
                "fine_tuning/status": "started"
            })
        except Exception as e:
            print(f"❌ W&B fine-tuning start logging failed: {e}")
    
    def log_fine_tuning_progress(self, epoch, loss, eval_score):
        """Log fine-tuning progress"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            self.run.log({
                "fine_tuning/epoch": epoch,
                "fine_tuning/training_loss": loss,
                "fine_tuning/eval_score": eval_score,
                "fine_tuning/progress_timestamp": datetime.now().timestamp()
            })
        except Exception as e:
            print(f"❌ W&B fine-tuning progress logging failed: {e}")
    
    def log_fine_tuning_complete(self, final_eval_score, deployed, improvement):
        """Log fine-tuning completion"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            self.run.log({
                "fine_tuning/final_eval_score": final_eval_score,
                "fine_tuning/deployed": deployed,
                "fine_tuning/improvement": improvement,
                "fine_tuning/completion_timestamp": datetime.now().timestamp(),
                "fine_tuning/status": "completed"
            })
        except Exception as e:
            print(f"❌ W&B fine-tuning completion logging failed: {e}")
    
    def log_judge_evaluation(self, query, video_id, judge_scores, average_score, quality_level, trigger_decision, evaluation_time):
        """Log LLM judge evaluation results"""
        if not self.is_initialized or not self.run:
            return
        
        try:
            self.run.log({
                "judge/average_score": average_score,
                "judge/quality_level": quality_level,
                "judge/trigger_decision": trigger_decision,
                "judge/evaluation_time": evaluation_time,
                "judge/num_results": len(judge_scores),
                "judge/min_score": min(judge_scores) if judge_scores else 0,
                "judge/max_score": max(judge_scores) if judge_scores else 0,
                "judge/timestamp": datetime.now().timestamp()
            })
            
            # Log individual scores as a histogram
            if judge_scores:
                for i, score in enumerate(judge_scores):
                    self.run.log({f"judge/result_{i+1}_score": score})
                    
        except Exception as e:
            print(f"❌ W&B judge evaluation logging failed: {e}")
    
    def finish(self):
        """Finish W&B run"""
        if self.is_initialized and self.run:
            try:
                wandb.finish()
                print("✅ W&B run finished")
            except Exception as e:
                print(f"❌ W&B finish failed: {e}")

# Global logger instance - will be initialized when imported
logger = None

def setup_wandb(project_name="reflex-agent-hackathon", entity=None):
    """Setup W&B logging"""
    global logger
    logger = WandBLogger(project_name, entity)
    return logger

# Initialize logger when module is imported
logger = WandBLogger()
