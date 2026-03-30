package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v9"
)

// CacheSetBody represents the request body for setting cache items
type CacheSetBody struct {
	Key   string `json:"key" binding:"required"`
	Value string `json:"value" binding:"required"`
	TTL   string `json:"ttl"`
}

// Config represents the application configuration
type Config struct {
	RedisHost string `json:"redis_host"`
	RedisPort int    `json:"redis_port"`
	TTL       int    `json:"ttl"`
}

// CacheService handles cache operations
type CacheService struct {
	client *redis.Client
	config *Config
	ctx    context.Context
}

// NewCacheService creates a new cache service instance
func NewCacheService(config *Config) *CacheService {
	rdb := redis.NewClient(&redis.Options{
		Addr:         fmt.Sprintf("%s:%d", config.RedisHost, config.RedisPort),
		Password:     "",
		DB:           0,
		PoolSize:     20,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		DialTimeout:  5 * time.Second,
	})

	return &CacheService{
		client: rdb,
		config: config,
		ctx:    context.Background(),
	}
}

// loadConfig reads and parses the configuration file
func loadConfig() (*Config, error) {
	configFile, err := os.Open("config.json")
	if err != nil {
		return nil, fmt.Errorf("failed to open config file: %w", err)
	}
	defer configFile.Close()

	byteValue, err := io.ReadAll(configFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config Config
	if err := json.Unmarshal(byteValue, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	return &config, nil
}

// HealthCheck performs a comprehensive health check
func (cs *CacheService) HealthCheck() error {
	ctx, cancel := context.WithTimeout(cs.ctx, 2*time.Second)
	defer cancel()

	return cs.client.Ping(ctx).Err()
}

// GetCache retrieves an item from the cache
func (cs *CacheService) GetCache(c *gin.Context) {
	key := c.DefaultQuery("key", "")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key query parameter is required"})
		return
	}

	val, err := cs.client.Get(cs.ctx, key).Result()
	if err == redis.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "key not found"})
		return
	} else if err != nil {
		log.Printf("Redis error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Get TTL
	itemTTL, err := cs.client.TTL(cs.ctx, key).Result()
	if err != nil {
		log.Printf("TTL error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	// Set cache headers
	c.Header("X-CACHE-TTL", fmt.Sprintf("%.0f", itemTTL.Seconds()))
	c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", int(itemTTL.Seconds())))

	c.JSON(http.StatusOK, val)
}

// SetCache adds an item to the cache
func (cs *CacheService) SetCache(c *gin.Context) {
	var requestBody CacheSetBody

	if err := c.ShouldBindJSON(&requestBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body", "details": err.Error()})
		return
	}

	var ttl time.Duration
	if requestBody.TTL == "" {
		ttl = time.Duration(cs.config.TTL) * time.Second
	} else {
		ttlInt, err := strconv.Atoi(requestBody.TTL)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ttl must be a string representation of an integer"})
			return
		}
		ttl = time.Duration(ttlInt) * time.Second
	}

	err := cs.client.Set(cs.ctx, requestBody.Key, requestBody.Value, ttl).Err()
	if err != nil {
		log.Printf("Redis set error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "cached"})
}

// Close closes the Redis connection
func (cs *CacheService) Close() error {
	return cs.client.Close()
}

func main() {
	// Load configuration
	config, err := loadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Create cache service
	cacheService := NewCacheService(config)
	defer cacheService.Close()

	// Test Redis connection
	if err := cacheService.HealthCheck(); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}

	// Create Gin router
	r := gin.Default()

	// Health endpoints
	r.GET("/health", func(c *gin.Context) {
		if err := cacheService.HealthCheck(); err != nil {
			c.String(http.StatusServiceUnavailable, "Redis connection failed")
			return
		}
		c.String(http.StatusOK, "OK")
	})

	r.GET("/api/health", func(c *gin.Context) {
		if err := cacheService.HealthCheck(); err != nil {
			c.String(http.StatusServiceUnavailable, "Redis connection failed")
			return
		}
		c.String(http.StatusOK, "OK")
	})

	// Cache endpoints
	r.GET("/api/cache", cacheService.GetCache)
	r.POST("/api/cache", cacheService.SetCache)

	// Create HTTP server with timeouts
	srv := &http.Server{
		Addr:         ":8080",
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		log.Println("Starting server on :8080")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	// Graceful shutdown with 5 second timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exiting")
}
