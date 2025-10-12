#!/usr/bin/env python3
"""
Self-Learning Pipeline for YoutubeAgent
Automatically improves the embedding model based on user feedback
"""

import os
import json
import sqlite3
import numpy as np
from datetime import datetime, timedelta
from typing import List, Tuple, Dict
import threading
import time
import schedule

from sentence_transformers import SentenceTransformer, InputExample, losses
from sentence_transformers.evaluation import EmbeddingSimilarityEvaluator
from torch.utils.data import DataLoader

class SelfLearningPipeline:
    def __init__(self, db_path="youtube_voice_agent.db", model_path="./models"):
        self.db_path = db_path
        self.model_path = model_path
        self.base_model_name = "all-MiniLM-L6-v2"
        self.current_model_version = 1
        self.min_training_samples = 5   # Minimum samples before retraining (demo-friendly)
        self.learning_threshold = 0.001  # Minimum improvement to deploy new model (demo-friendly)
        
        # Create models directory
        os.makedirs(model_path, exist_ok=True)
        
        # Initialize base model
        self.load_or_create_model()
        
        # Start background learning thread
        self.start_background_learning()
    
    def load_or_create_model(self):
        """Load existing fine-tuned model or create base model"""
        try:
            # Try to load latest fine-tuned model
            latest_model_path = f"{self.model_path}/reflex-agent-v{self.current_model_version}"
            if os.path.exists(latest_model_path):
                self.model = SentenceTransformer(latest_model_path)
                print(f"✅ Loaded fine-tuned model v{self.current_model_version}")
            else:
                # Load base model
                self.model = SentenceTransformer(self.base_model_name)
                print(f"✅ Loaded base model: {self.base_model_name}")
        except Exception as e:
            print(f"❌ Error loading model: {e}")
            self.model = SentenceTransformer(self.base_model_name)
    
    def collect_training_data(self, days_back=7) -> List[InputExample]:
        """Collect training data from user feedback"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Get feedback from last N days
            cutoff_date = (datetime.now() - timedelta(days=days_back)).isoformat()
            
            cursor.execute("""
                SELECT query, chunk_text, user_rating, relevance_score
                FROM chunk_ratings 
                WHERE timestamp > ? AND user_rating IS NOT NULL
                ORDER BY timestamp DESC
            """, (cutoff_date,))
            
            feedback_data = cursor.fetchall()
            conn.close()
            
            print(f"📊 Found {len(feedback_data)} feedback entries in database")
            
            if len(feedback_data) < self.min_training_samples:
                print(f"⚠️  Not enough training data: {len(feedback_data)} samples (need {self.min_training_samples})")
                return []
            
            # Create training examples
            examples = []
            
            for query, chunk_text, rating, relevance_score in feedback_data:
                # Convert 1-5 rating to similarity score (0-1)
                similarity_score = (rating - 1) / 4.0
                
                # Include ALL ratings for more training data
                examples.append(InputExample(
                    texts=[query, chunk_text], 
                    label=similarity_score
                ))
                
                # Optional: Add more weight to extreme examples
                if rating >= 4 or rating <= 2:
                    # Add duplicate for stronger signal on clear preferences
                    examples.append(InputExample(
                        texts=[query, chunk_text], 
                        label=similarity_score
                    ))
            
            print(f"📊 Collected {len(examples)} training examples from {len(feedback_data)} feedback entries")
            return examples
            
        except Exception as e:
            print(f"❌ Error collecting training data: {e}")
            return []
    
    def create_evaluation_data(self, training_examples: List[InputExample]) -> List[InputExample]:
        """Create evaluation dataset from training data"""
        # Use 20% of data for evaluation
        eval_size = max(10, len(training_examples) // 5)
        return training_examples[-eval_size:]
    
    def fine_tune_model(self, training_examples: List[InputExample]) -> Tuple[SentenceTransformer, float]:
        """Fine-tune the model with collected feedback data"""
        try:
            print("🔄 Starting model fine-tuning...")
            
            # Create evaluation data
            eval_examples = self.create_evaluation_data(training_examples)
            train_examples = training_examples[:-len(eval_examples)]
            
            # Log fine-tuning start to W&B
            try:
                from wandb_logger import logger as wandb_logger
                wandb_logger.log_fine_tuning_start(len(train_examples), len(eval_examples))
            except:
                pass
            
            # Create a copy of current model for fine-tuning
            model_copy = SentenceTransformer(self.base_model_name)
            
            # Create data loader
            train_dataloader = DataLoader(train_examples, shuffle=True, batch_size=16)
            
            # Define loss function
            train_loss = losses.CosineSimilarityLoss(model_copy)
            
            # Create evaluator
            evaluator = EmbeddingSimilarityEvaluator.from_input_examples(
                eval_examples, name='eval'
            )
            
            # Fine-tune model with progress logging
            epochs = 3
            for epoch in range(epochs):
                print(f"📚 Fine-tuning epoch {epoch + 1}/{epochs}")
                
                model_copy.fit(
                    train_objectives=[(train_dataloader, train_loss)],
                    epochs=1,  # One epoch at a time for progress logging
                    warmup_steps=100 if epoch == 0 else 0,
                    evaluator=evaluator,
                    evaluation_steps=50,
                    output_path=f"{self.model_path}/temp_model"
                )
                
                # Log progress to W&B
                try:
                    eval_score = evaluator(model_copy)
                    if isinstance(eval_score, dict):
                        eval_score = eval_score.get('eval_cosine_accuracy', 0.0)
                    from wandb_logger import logger as wandb_logger
                    wandb_logger.log_fine_tuning_progress(epoch + 1, 0.0, eval_score)
                except Exception as e:
                    print(f"⚠️  Evaluation error: {e}")
                    pass
            
            # Final evaluation
            try:
                eval_result = evaluator(model_copy)
                print(f"🔍 Raw evaluation result: {eval_result}")
                
                # Handle different return types
                if isinstance(eval_result, dict):
                    # Try different possible keys
                    eval_score = (eval_result.get('eval_cosine_accuracy') or 
                                eval_result.get('cosine_accuracy') or 
                                eval_result.get('accuracy') or 
                                eval_result.get('eval_spearman_cosine') or
                                list(eval_result.values())[0] if eval_result else 0.0)
                else:
                    eval_score = float(eval_result) if eval_result is not None else 0.0
                    
                print(f"📈 Fine-tuning completed. Evaluation score: {eval_score:.4f}")
            except Exception as e:
                print(f"❌ Final evaluation error: {e}")
                eval_score = 0.0
            
            return model_copy, eval_score
            
        except Exception as e:
            print(f"❌ Error during fine-tuning: {e}")
            return None, 0.0
    
    def evaluate_model_improvement(self, new_model: SentenceTransformer, eval_score: float) -> bool:
        """Evaluate if new model is better than current model"""
        try:
            # Simple evaluation: if eval score is above threshold, deploy
            if eval_score > self.learning_threshold:
                print(f"✅ New model shows improvement: {eval_score:.4f} > {self.learning_threshold}")
                return True
            else:
                print(f"⚠️  New model doesn't meet improvement threshold: {eval_score:.4f} <= {self.learning_threshold}")
                return False
                
        except Exception as e:
            print(f"❌ Error evaluating model: {e}")
            return False
    
    def deploy_new_model(self, new_model: SentenceTransformer):
        """Deploy new model and update version"""
        try:
            # Increment version
            self.current_model_version += 1
            new_model_path = f"{self.model_path}/reflex-agent-v{self.current_model_version}"
            
            # Save new model
            new_model.save(new_model_path)
            
            # Update current model
            self.model = new_model
            
            # Log deployment
            deployment_log = {
                "version": self.current_model_version,
                "timestamp": datetime.now().isoformat(),
                "model_path": new_model_path
            }
            
            with open(f"{self.model_path}/deployment_log.json", "a") as f:
                f.write(json.dumps(deployment_log) + "\n")
            
            print(f"🚀 Deployed new model version {self.current_model_version}")
            
            # Log to W&B if available
            try:
                from wandb_logger import logger as wandb_logger
                wandb_logger.log_model_update(self.current_model_version, new_model_path)
            except:
                pass
                
        except Exception as e:
            print(f"❌ Error deploying model: {e}")
    
    def learning_cycle(self):
        """Complete learning cycle: collect data → train → evaluate → deploy"""
        print("🔄 Starting self-learning cycle...")
        print(f"⏰ Triggered at: {datetime.now().strftime('%H:%M:%S')}")
        
        # Step 1: Collect training data
        training_examples = self.collect_training_data()
        if not training_examples:
            print("⏭️  Skipping learning cycle - insufficient data")
            return
        
        # Step 2: Fine-tune model
        new_model, eval_score = self.fine_tune_model(training_examples)
        if new_model is None:
            print("❌ Learning cycle failed - fine-tuning error")
            return
        
        # Step 3: Evaluate improvement
        improvement_detected = self.evaluate_model_improvement(new_model, eval_score)
        
        if improvement_detected:
            # Step 4: Deploy new model
            self.deploy_new_model(new_model)
            print("✅ Self-learning cycle completed successfully")
            
            # Log successful completion to W&B
            try:
                from wandb_logger import logger as wandb_logger
                wandb_logger.log_fine_tuning_complete(eval_score, True, eval_score - self.learning_threshold)
            except:
                pass
        else:
            print("⏭️  Model not deployed - insufficient improvement")
            
            # Log unsuccessful completion to W&B
            try:
                from wandb_logger import logger as wandb_logger
                wandb_logger.log_fine_tuning_complete(eval_score, False, eval_score - self.learning_threshold)
            except:
                pass
    
    def start_background_learning(self):
        """Start background thread for continuous learning"""
        def learning_scheduler():
            # Schedule learning cycles (demo-friendly)
            schedule.every(2).minutes.do(self.learning_cycle)  # Learn every 2 minutes for demo
            
            print("🕐 Scheduler loop starting...")
            while True:
                schedule.run_pending()
                time.sleep(30)  # Check every 30 seconds for demo
        
        # Start scheduler in background thread
        learning_thread = threading.Thread(target=learning_scheduler, daemon=True)
        learning_thread.start()
        print("🤖 Self-learning scheduler started (every 2 minutes for demo)")
    
    def get_embeddings(self, texts: List[str]) -> np.ndarray:
        """Get embeddings using current model"""
        return self.model.encode(texts)
    
    def get_model_info(self) -> Dict:
        """Get current model information"""
        return {
            "version": self.current_model_version,
            "base_model": self.base_model_name,
            "model_path": f"{self.model_path}/reflex-agent-v{self.current_model_version}",
            "last_updated": datetime.now().isoformat()
        }

# Global instance
self_learning_pipeline = None

def initialize_self_learning():
    """Initialize the self-learning pipeline"""
    global self_learning_pipeline
    if self_learning_pipeline is None:
        self_learning_pipeline = SelfLearningPipeline()
    return self_learning_pipeline

def get_embeddings(texts: List[str]) -> np.ndarray:
    """Get embeddings using the self-learning model"""
    pipeline = initialize_self_learning()
    return pipeline.get_embeddings(texts)

def trigger_learning_cycle():
    """Manually trigger a learning cycle"""
    pipeline = initialize_self_learning()
    pipeline.learning_cycle()

if __name__ == "__main__":
    # Test the pipeline
    pipeline = initialize_self_learning()
    print("🧠 Self-learning pipeline initialized")
    
    # Trigger immediate learning cycle for testing
    pipeline.learning_cycle()
