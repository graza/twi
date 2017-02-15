#
# This is a Shiny web application. You can run the application by clicking
# the 'Run App' button above.
#
# Find out more about building applications with Shiny here:
#
#    http://shiny.rstudio.com/
#

library(shiny)
library(rredis)
library(stringr)
library(RJSONIO)

redisConnect(host = 'redis', nodelay = FALSE)
clientq <- paste0(
  "client",
  str_match_all(
    redisCmd("CLIENT", "LIST"), "id=(\\d+) .* idle=0 .* cmd=client"
  )[[1]][2]
)

finddocs <- function(query) {
  if (str_length(query)) {
    #redisLPush("worker", toJSON(c("finddocs", clientq, query))
    # Using redisCmd because LPush seems to put rubbish at start of message
    redisCmd("LPUSH", "worker", toJSON(c("finddocs", clientq, query)))
    reply <- redisBRPop(clientq, timeout = 60)
    return(fromJSON(reply[[clientq]]))
  }
}

# Define UI for application that draws a histogram
ui <- fluidPage(
  titlePanel("CT5107 Graph Query Engine "),
  flowLayout(
    textInput("query", NULL, placeholder = "Enter your query"),
    submitButton( "Go!")
  ),
  uiOutput("results")
)

# Define server logic required to draw a histogram
server <- function(input, output) {
  output$results <- renderUI({
    start_time <- proc.time()
    results <- finddocs(input$query)
    query_time <- proc.time() - start_time
    tagList(
      tags$p(paste(round(query_time[3], digits = 3), "ms")),
      tags$pre(toJSON(results, pretty = TRUE))
    )
  })
}

# Run the application 
shinyApp(ui = ui, server = server)
