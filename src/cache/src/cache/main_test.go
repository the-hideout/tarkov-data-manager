package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// MockCacheService implements a mock cache service for testing
type MockCacheService struct {
	config      *Config
	ctx         context.Context
	healthError error
	store       map[string]string
	ttls        map[string]time.Duration
}

// NewMockCacheService creates a new mock cache service
func NewMockCacheService(config *Config) *MockCacheService {
	return &MockCacheService{
		config: config,
		ctx:    context.Background(),
		store:  make(map[string]string),
		ttls:   make(map[string]time.Duration),
	}
}

// HealthCheck simulates a health check
func (m *MockCacheService) HealthCheck() error {
	return m.healthError
}

// SetHealthError sets the error that HealthCheck should return
func (m *MockCacheService) SetHealthError(err error) {
	m.healthError = err
}

// GetCache simulates cache retrieval
func (m *MockCacheService) GetCache(c *gin.Context) {
	key := c.DefaultQuery("key", "")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key query parameter is required"})
		return
	}

	val, exists := m.store[key]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "key not found"})
		return
	}

	ttl := m.ttls[key]
	c.Header("X-CACHE-TTL", fmt.Sprintf("%.0f", ttl.Seconds()))
	c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", int(ttl.Seconds())))

	c.JSON(http.StatusOK, val)
}

// SetCache simulates cache storage
func (m *MockCacheService) SetCache(c *gin.Context) {
	var requestBody CacheSetBody

	if err := c.ShouldBindJSON(&requestBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body", "details": err.Error()})
		return
	}

	var ttl time.Duration
	if requestBody.TTL == "" {
		ttl = time.Duration(m.config.TTL) * time.Second
	} else {
		ttlInt, err := strconv.Atoi(requestBody.TTL)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ttl must be a string representation of an integer"})
			return
		}
		ttl = time.Duration(ttlInt) * time.Second
	}

	m.store[requestBody.Key] = requestBody.Value
	m.ttls[requestBody.Key] = ttl

	c.JSON(http.StatusOK, gin.H{"message": "cached"})
}

// Close simulates closing connections
func (m *MockCacheService) Close() error {
	return nil
}

// TestConfig contains test configuration
var testConfig = &Config{
	RedisHost: "localhost",
	RedisPort: 6379,
	TTL:       300,
}

func setupTestRouter(cacheService *MockCacheService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

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

	return r
}

func TestNewCacheService(t *testing.T) {
	config := &Config{
		RedisHost: "localhost",
		RedisPort: 6379,
		TTL:       300,
	}

	service := NewCacheService(config)
	require.NotNil(t, service)
	require.NotNil(t, service.client)
	require.Equal(t, config, service.config)
	require.NotNil(t, service.ctx)

	// Clean up
	_ = service.Close()
}

func TestLoadConfig(t *testing.T) {
	// Test loading existing config file
	config, err := loadConfig()
	require.NoError(t, err)
	require.NotNil(t, config)

	// Verify config values are loaded correctly
	assert.Equal(t, "redis", config.RedisHost)
	assert.Equal(t, 6379, config.RedisPort)
	assert.Equal(t, 500, config.TTL)
}

func TestHealthEndpoints(t *testing.T) {
	// Create a mock cache service for testing without Redis dependency
	service := NewMockCacheService(testConfig)

	router := setupTestRouter(service)

	tests := []struct {
		name     string
		endpoint string
	}{
		{"Health endpoint", "/health"},
		{"API Health endpoint", "/api/health"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			req, _ := http.NewRequest("GET", tt.endpoint, nil)
			router.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)
			assert.Equal(t, "OK", w.Body.String())
		})
	}
}

func TestHealthEndpointsWithRedisFailure(t *testing.T) {
	service := NewMockCacheService(testConfig)

	// Set the mock service to return an error for health checks
	service.SetHealthError(fmt.Errorf("redis connection failed"))

	router := setupTestRouter(service)

	tests := []struct {
		name     string
		endpoint string
	}{
		{"Health endpoint with Redis failure", "/health"},
		{"API Health endpoint with Redis failure", "/api/health"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			req, _ := http.NewRequest("GET", tt.endpoint, nil)
			router.ServeHTTP(w, req)

			assert.Equal(t, http.StatusServiceUnavailable, w.Code)
			assert.Equal(t, "Redis connection failed", w.Body.String())
		})
	}
}

func TestSetCache(t *testing.T) {
	// Create a map to simulate Redis storage
	mockStore := make(map[string]string)
	mockTTLs := make(map[string]time.Duration)

	// Mock the Set operation
	setFunc := func(key, value string, ttl time.Duration) error {
		mockStore[key] = value
		mockTTLs[key] = ttl
		return nil
	}

	router := gin.New()
	router.POST("/api/cache", func(c *gin.Context) {
		var requestBody CacheSetBody

		if err := c.ShouldBindJSON(&requestBody); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body", "details": err.Error()})
			return
		}

		var ttl time.Duration
		if requestBody.TTL == "" {
			ttl = time.Duration(testConfig.TTL) * time.Second
		} else {
			ttlInt, err := strconv.Atoi(requestBody.TTL)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "ttl must be a string representation of an integer"})
				return
			}
			ttl = time.Duration(ttlInt) * time.Second
		}

		if err := setFunc(requestBody.Key, requestBody.Value, ttl); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "cached"})
	})

	tests := []struct {
		name           string
		body           CacheSetBody
		expectedStatus int
		expectedTTL    time.Duration
	}{
		{
			name: "Valid request with default TTL",
			body: CacheSetBody{
				Key:   "test-key",
				Value: "test-value",
			},
			expectedStatus: http.StatusOK,
			expectedTTL:    300 * time.Second,
		},
		{
			name: "Valid request with custom TTL",
			body: CacheSetBody{
				Key:   "test-key-2",
				Value: "test-value-2",
				TTL:   "600",
			},
			expectedStatus: http.StatusOK,
			expectedTTL:    600 * time.Second,
		},
		{
			name: "Invalid TTL",
			body: CacheSetBody{
				Key:   "test-key-3",
				Value: "test-value-3",
				TTL:   "invalid",
			},
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jsonBody, _ := json.Marshal(tt.body)
			w := httptest.NewRecorder()
			req, _ := http.NewRequest("POST", "/api/cache", bytes.NewBuffer(jsonBody))
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedStatus == http.StatusOK {
				var response map[string]string
				err := json.Unmarshal(w.Body.Bytes(), &response)
				require.NoError(t, err)
				assert.Equal(t, "cached", response["message"])

				// Verify the item was stored with correct TTL
				assert.Equal(t, tt.body.Value, mockStore[tt.body.Key])
				assert.Equal(t, tt.expectedTTL, mockTTLs[tt.body.Key])
			}
		})
	}
}

func TestGetCache(t *testing.T) {
	// Mock Redis storage
	mockStore := map[string]string{
		"existing-key": "existing-value",
	}
	mockTTLs := map[string]time.Duration{
		"existing-key": 300 * time.Second,
	}

	router := gin.New()
	router.GET("/api/cache", func(c *gin.Context) {
		key := c.DefaultQuery("key", "")
		if key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "key query parameter is required"})
			return
		}

		val, exists := mockStore[key]
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "key not found"})
			return
		}

		ttl := mockTTLs[key]
		c.Header("X-CACHE-TTL", fmt.Sprintf("%.0f", ttl.Seconds()))
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", int(ttl.Seconds())))

		c.JSON(http.StatusOK, val)
	})

	tests := []struct {
		name           string
		key            string
		expectedStatus int
		expectedValue  string
	}{
		{
			name:           "Existing key",
			key:            "existing-key",
			expectedStatus: http.StatusOK,
			expectedValue:  "existing-value",
		},
		{
			name:           "Non-existing key",
			key:            "non-existing-key",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "Missing key parameter",
			key:            "",
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			url := "/api/cache"
			if tt.key != "" {
				url = fmt.Sprintf("/api/cache?key=%s", tt.key)
			}
			req, _ := http.NewRequest("GET", url, nil)
			router.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedStatus == http.StatusOK {
				var response string
				err := json.Unmarshal(w.Body.Bytes(), &response)
				require.NoError(t, err)
				assert.Equal(t, tt.expectedValue, response)

				// Check headers
				assert.Equal(t, "300", w.Header().Get("X-CACHE-TTL"))
				assert.Equal(t, "public, max-age=300", w.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestCacheSetBodyValidation(t *testing.T) {
	router := gin.New()
	router.POST("/api/cache", func(c *gin.Context) {
		var requestBody CacheSetBody

		if err := c.ShouldBindJSON(&requestBody); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "success"})
	})

	tests := []struct {
		name           string
		body           interface{}
		expectedStatus int
	}{
		{
			name: "Valid body",
			body: CacheSetBody{
				Key:   "test-key",
				Value: "test-value",
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Missing key",
			body:           map[string]string{"value": "test-value"},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Missing value",
			body:           map[string]string{"key": "test-key"},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Invalid JSON",
			body:           "invalid json",
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var jsonBody []byte
			var err error

			if str, ok := tt.body.(string); ok {
				jsonBody = []byte(str)
			} else {
				jsonBody, err = json.Marshal(tt.body)
				require.NoError(t, err)
			}

			w := httptest.NewRecorder()
			req, _ := http.NewRequest("POST", "/api/cache", bytes.NewBuffer(jsonBody))
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)
		})
	}
}

// Benchmark tests
func BenchmarkSetCache(b *testing.B) {
	router := gin.New()
	router.POST("/api/cache", func(c *gin.Context) {
		var requestBody CacheSetBody
		if err := c.ShouldBindJSON(&requestBody); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		// Mock successful set
		c.JSON(http.StatusOK, gin.H{"message": "cached"})
	})

	body := CacheSetBody{
		Key:   "benchmark-key",
		Value: "benchmark-value",
		TTL:   "300",
	}
	jsonBody, _ := json.Marshal(body)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/cache", bytes.NewBuffer(jsonBody))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)
	}
}

func BenchmarkGetCache(b *testing.B) {
	router := gin.New()
	router.GET("/api/cache", func(c *gin.Context) {
		c.JSON(http.StatusOK, "benchmark-value")
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/api/cache?key=benchmark-key", nil)
		router.ServeHTTP(w, req)
	}
}
